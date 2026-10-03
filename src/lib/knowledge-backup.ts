import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";

import * as yazl from "yazl";
import { z } from "zod";

import { getKnowledgeSourceRoot, knowledgeDb } from "@/lib/knowledge-db";
import { rebuildKnowledgeFts } from "@/lib/knowledge-documents";
import { expandKnowledgeKeywords } from "@/lib/knowledge-keywords";
import { parseKnowledgeLocator, serializeKnowledgeLocator, sourceFormatForFileName, subtitleLocator } from "@/lib/knowledge-source";
import { knowledgeSourceFormats, knowledgeSourceTypes } from "@/lib/knowledge-types";

const nullableNumber = z.number().int().nullable();
const embeddingSchema = z.object({ profileId: z.string(), path: z.string(), byteLength: z.number().int().positive() });
const chunkSchema = z.object({
  id: z.string(), ordinal: z.number().int(), sourceCueStart: z.number().int(), sourceCueEnd: z.number().int(),
  startMs: nullableNumber, endMs: nullableNumber, originalText: z.string(), cleanedText: z.string(),
  topic: z.string(), keywords: z.array(z.string()), embeddings: z.array(embeddingSchema),
  locatorKind: z.enum(["SUBTITLE", "TEXT"]).optional(),
  locator: z.discriminatedUnion("kind", [
    z.object({ v: z.literal(1), kind: z.literal("subtitle"), cueStart: z.number().int().positive(), cueEnd: z.number().int().positive(), startMs: nullableNumber, endMs: nullableNumber }),
    z.object({ v: z.literal(1), kind: z.literal("text"), lineStart: z.number().int().positive(), lineEnd: z.number().int().positive(), headingPath: z.array(z.string()) }),
  ]).optional(),
});
const versionSchema = z.object({
  id: z.string(), versionNumber: z.number().int().positive(), sourceFileName: z.string(), sourceMimeType: z.string(),
  sourceSizeBytes: z.number().int().nonnegative(), sourceHash: z.string().regex(/^[a-f0-9]{64}$/), sourcePath: z.string(), rawText: z.string(),
  status: z.string(), approvalMode: z.string(), processorEndpointId: z.string().nullable(), processorModel: z.string().nullable(),
  processorPromptHash: z.string().nullable(), processingMode: z.enum(["QUICK", "AI"]).default("AI"),
  processingRuleVersion: z.string().default("legacy-v1"), sourceFormat: z.enum(knowledgeSourceFormats).optional(),
  error: z.string().nullable(), activatedAt: z.string().nullable(), chunks: z.array(chunkSchema),
});
const bindingSchema = z.object({
  indexPath: z.string(), appliesToDescendants: z.boolean(), status: z.enum(["ACTIVE", "ORPHANED"]),
});
const documentSchema = z.object({
  id: z.string(), title: z.string(), lessonCode: z.string().nullable(),
  sourceType: z.enum(knowledgeSourceTypes).optional(), enabled: z.boolean().optional(),
  binding: bindingSchema.nullable().optional(),
  // v6 and earlier knowledge payloads stored binding fields on the document.
  indexPath: z.string().optional(), appliesToDescendants: z.boolean().optional(), bindingStatus: z.string().optional(),
  versions: z.array(versionSchema),
});
const profileSchema = z.object({ id: z.string(), endpointId: z.string(), model: z.string(), dimensions: z.number().int().nonnegative(), status: z.string() });

export const backupKnowledgeSchema = z.object({
  profiles: z.array(profileSchema),
  documents: z.array(documentSchema),
});
export type BackupKnowledge = z.infer<typeof backupKnowledgeSchema>;

type LazyZip = yazl.ZipFile & { addReadStreamLazy: (
  metadataPath: string,
  options: { mode: number; mtime: Date; size: number },
  getReadStream: (callback: (error: Error | null, stream?: Readable) => void) => void,
) => void };

type SourceEntry = { zipPath: string; fullPath: string; size: number; mode: number; mtime: Date };

function iso(value: unknown) {
  if (!value) return null;
  return new Date(String(value)).toISOString();
}

function safeExtension(fileName: string) {
  const extension = path.extname(fileName).toLowerCase();
  return /^[.][a-z0-9]{1,8}$/.test(extension) ? extension : ".txt";
}

export async function collectKnowledgeBackup(options: {
  allowedOriginalPaths: Set<string> | null;
  exportPathByOriginalPath: Map<string, string>;
}) {
  const db = knowledgeDb();
  const allDocuments = db.prepare(`SELECT d.*, b.indexNodeId, b.indexPathSnapshot, b.appliesToDescendants,
    b.status AS bindingStatus FROM KnowledgeDocument d
    LEFT JOIN KnowledgeDocumentBinding b ON b.documentId = d.id
    ORDER BY COALESCE(b.indexPathSnapshot, ''), d.id`).all() as Array<Record<string, unknown>>;
  const documents = allDocuments.filter((document) => {
    if (!options.allowedOriginalPaths) return true;
    return Boolean(document.indexNodeId) && options.allowedOriginalPaths.has(String(document.indexPathSnapshot));
  });
  const sourceEntries = new Map<string, SourceEntry>();
  const usedProfileIds = new Set<string>();
  const versionQuery = db.prepare("SELECT * FROM KnowledgeDocumentVersion WHERE documentId = ? ORDER BY versionNumber");
  const chunkQuery = db.prepare("SELECT * FROM KnowledgeChunk WHERE versionId = ? ORDER BY ordinal");
  const embeddingQuery = db.prepare("SELECT profileId, length(embedding) AS byteLength FROM KnowledgeChunkEmbedding WHERE chunkId = ? ORDER BY profileId");

  const backupDocuments: BackupKnowledge["documents"] = [];
  for (const document of documents) {
    const versions = versionQuery.all(document.id) as Array<Record<string, unknown>>;
    const backupVersions: BackupKnowledge["documents"][number]["versions"] = [];
    for (const version of versions) {
      const sourceZipPath = `knowledge/sources/${version.sourceHash}${safeExtension(String(version.sourceFileName))}`;
      if (!sourceEntries.has(sourceZipPath)) {
        const fullPath = path.resolve(/* turbopackIgnore: true */ process.cwd(), String(version.sourcePath));
        const sourceStat = await stat(/* turbopackIgnore: true */ fullPath);
        sourceEntries.set(sourceZipPath, { zipPath: sourceZipPath, fullPath, size: sourceStat.size, mode: sourceStat.mode, mtime: sourceStat.mtime });
      }
      const chunks = (chunkQuery.all(version.id) as Array<Record<string, unknown>>).map((chunk) => {
        const embeddings = (embeddingQuery.all(chunk.id) as Array<{ profileId: string; byteLength: number }>).map((embedding) => {
          usedProfileIds.add(embedding.profileId);
          return { profileId: embedding.profileId, path: `knowledge/embeddings/${embedding.profileId}/${chunk.id}.f32`, byteLength: embedding.byteLength };
        });
        return {
          id: String(chunk.id), ordinal: Number(chunk.ordinal), sourceCueStart: Number(chunk.sourceCueStart), sourceCueEnd: Number(chunk.sourceCueEnd),
          startMs: chunk.startMs === null ? null : Number(chunk.startMs), endMs: chunk.endMs === null ? null : Number(chunk.endMs),
          originalText: String(chunk.originalText), cleanedText: String(chunk.cleanedText), topic: String(chunk.topic),
          keywords: JSON.parse(String(chunk.keywordsJson)) as string[], embeddings,
          locatorKind: chunk.locatorKind === "TEXT" ? "TEXT" as const : "SUBTITLE" as const,
          locator: parseKnowledgeLocator(String(chunk.locatorJson), {
            cueStart: Number(chunk.sourceCueStart), cueEnd: Number(chunk.sourceCueEnd),
            startMs: chunk.startMs === null ? null : Number(chunk.startMs),
            endMs: chunk.endMs === null ? null : Number(chunk.endMs),
          }),
        };
      });
      backupVersions.push({
        id: String(version.id), versionNumber: Number(version.versionNumber), sourceFileName: String(version.sourceFileName),
        sourceMimeType: String(version.sourceMimeType), sourceSizeBytes: Number(version.sourceSizeBytes), sourceHash: String(version.sourceHash),
        sourcePath: sourceZipPath, rawText: String(version.rawText), status: String(version.status), approvalMode: String(version.approvalMode),
        processorEndpointId: version.processorEndpointId ? String(version.processorEndpointId) : null,
        processorModel: version.processorModel ? String(version.processorModel) : null,
        processorPromptHash: version.processorPromptHash ? String(version.processorPromptHash) : null,
        sourceFormat: knowledgeSourceFormats.includes(version.sourceFormat as (typeof knowledgeSourceFormats)[number])
          ? version.sourceFormat as (typeof knowledgeSourceFormats)[number]
          : sourceFormatForFileName(String(version.sourceFileName)),
        processingMode: version.processingMode === "QUICK" ? "QUICK" : "AI",
        processingRuleVersion: String(version.processingRuleVersion ?? "legacy-v1"),
        error: version.error ? String(version.error) : null, activatedAt: iso(version.activatedAt), chunks,
      });
    }
    backupDocuments.push({
      id: String(document.id), title: String(document.title), lessonCode: document.lessonCode ? String(document.lessonCode) : null,
      sourceType: knowledgeSourceTypes.includes(document.sourceType as (typeof knowledgeSourceTypes)[number])
        ? document.sourceType as (typeof knowledgeSourceTypes)[number]
        : "SUBTITLE",
      enabled: Boolean(document.enabled),
      binding: document.bindingStatus ? {
        indexPath: options.exportPathByOriginalPath.get(String(document.indexPathSnapshot)) ?? String(document.indexPathSnapshot),
        appliesToDescendants: Boolean(document.appliesToDescendants),
        status: document.bindingStatus === "ORPHANED" ? "ORPHANED" : "ACTIVE",
      } : null,
      versions: backupVersions,
    });
  }
  const profiles = usedProfileIds.size
    ? db.prepare(`SELECT id, endpointId, model, dimensions, status FROM KnowledgeEmbeddingProfile WHERE id IN (${[...usedProfileIds].map(() => "?").join(",")})`)
      .all(...usedProfileIds) as BackupKnowledge["profiles"]
    : [];
  return { knowledge: backupKnowledgeSchema.parse({ profiles, documents: backupDocuments }), sourceEntries: [...sourceEntries.values()] };
}

export function knowledgeZipPaths(knowledge: BackupKnowledge) {
  const paths = new Set<string>();
  for (const document of knowledge.documents) for (const version of document.versions) {
    paths.add(version.sourcePath);
    for (const chunk of version.chunks) for (const embedding of chunk.embeddings) paths.add(embedding.path);
  }
  return paths;
}

export function addKnowledgeToZip(zipFile: yazl.ZipFile, collected: Awaited<ReturnType<typeof collectKnowledgeBackup>>) {
  for (const source of collected.sourceEntries) {
    zipFile.addFile(source.fullPath, source.zipPath, { mode: source.mode, mtime: source.mtime });
  }
  const lazy = zipFile as LazyZip;
  for (const document of collected.knowledge.documents) for (const version of document.versions) {
    for (const chunk of version.chunks) for (const embedding of chunk.embeddings) {
      lazy.addReadStreamLazy(embedding.path, { mode: 0o600, mtime: new Date(), size: embedding.byteLength }, (callback) => {
        try {
          const row = knowledgeDb().prepare("SELECT embedding FROM KnowledgeChunkEmbedding WHERE chunkId = ? AND profileId = ?")
            .get(chunk.id, embedding.profileId) as { embedding: Buffer } | undefined;
          if (!row || row.embedding.length !== embedding.byteLength) throw new Error(`Knowledge embedding is missing: ${embedding.path}`);
          callback(null, Readable.from(row.embedding));
        } catch (error) { callback(error instanceof Error ? error : new Error(String(error))); }
      });
    }
  }
}

export type KnowledgeRestoreState = {
  sourceTargets: Map<string, string>;
  embeddingTargets: Map<string, { chunkId: string; profileId: string; byteLength: number }>;
  activeProfileId: string | null;
  restoredDocuments: number;
};

function normalizedBackupBinding(document: BackupKnowledge["documents"][number]) {
  if (document.binding !== undefined) return document.binding;
  if (!document.indexPath) return null;
  return {
    indexPath: document.indexPath,
    appliesToDescendants: document.appliesToDescendants ?? true,
    status: document.bindingStatus === "ORPHANED" ? "ORPHANED" as const : "ACTIVE" as const,
  };
}

export async function prepareKnowledgeRestore(knowledge: BackupKnowledge, indexIdByPath: Map<string, string>) {
  const db = knowledgeDb();
  const sourceTargets = new Map<string, string>();
  const embeddingTargets = new Map<string, { chunkId: string; profileId: string; byteLength: number }>();
  const profileIds = new Map<string, string>();
  let activeProfileId: string | null = null;
  for (const profile of knowledge.profiles) {
    const existing = db.prepare("SELECT id FROM KnowledgeEmbeddingProfile WHERE endpointId = ? AND model = ? AND dimensions = ? ORDER BY createdAt LIMIT 1")
      .get(profile.endpointId, profile.model, profile.dimensions) as { id: string } | undefined;
    const id = existing?.id ?? randomUUID();
    if (!existing) db.prepare("INSERT INTO KnowledgeEmbeddingProfile (id, endpointId, model, dimensions, status) VALUES (?, ?, ?, ?, 'RETIRED')")
      .run(id, profile.endpointId, profile.model, profile.dimensions);
    profileIds.set(profile.id, id);
    if (profile.status === "ACTIVE") activeProfileId = id;
  }

  db.transaction(() => {
    for (const document of knowledge.documents) {
      const sourceType = document.sourceType ?? "SUBTITLE";
      const enabled = document.enabled ?? document.bindingStatus !== "DISABLED";
      const binding = normalizedBackupBinding(document);
      const indexNodeId = binding ? indexIdByPath.get(binding.indexPath) ?? null : null;
      const existing = indexNodeId
        ? db.prepare(`SELECT d.id, d.sourceType FROM KnowledgeDocument d
            JOIN KnowledgeDocumentBinding b ON b.documentId = d.id WHERE b.indexNodeId = ?`)
          .get(indexNodeId) as { id: string; sourceType: string } | undefined
        : db.prepare("SELECT id, sourceType FROM KnowledgeDocument WHERE id = ?").get(document.id) as { id: string; sourceType: string } | undefined;
      if (existing && existing.sourceType !== sourceType) {
        throw new Error(`资料恢复冲突：索引节点“${binding?.indexPath ?? "未关联"}”已绑定 ${existing.sourceType} 资料，不能覆盖为 ${sourceType}。`);
      }
      const documentId = existing?.id ?? randomUUID();
      if (existing) db.prepare(`UPDATE KnowledgeDocument SET title = ?, lessonCode = ?, normalizedLessonCode = ?,
        enabled = ?, updatedAt = ? WHERE id = ?`)
        .run(document.title, document.lessonCode, document.lessonCode?.normalize("NFKC").toLocaleLowerCase() ?? null,
          enabled ? 1 : 0, new Date().toISOString(), documentId);
      else db.prepare(`INSERT INTO KnowledgeDocument
        (id, title, lessonCode, normalizedLessonCode, sourceType, enabled)
        VALUES (?, ?, ?, ?, ?, ?)`)
        .run(documentId, document.title, document.lessonCode, document.lessonCode?.normalize("NFKC").toLocaleLowerCase() ?? null,
          sourceType, enabled ? 1 : 0);
      if (binding) {
        const bindingStatus = indexNodeId && binding.status !== "ORPHANED" ? "ACTIVE" : "ORPHANED";
        const currentBinding = db.prepare("SELECT id FROM KnowledgeDocumentBinding WHERE documentId = ?")
          .get(documentId) as { id: string } | undefined;
        if (currentBinding) {
          db.prepare(`UPDATE KnowledgeDocumentBinding SET indexNodeId = ?, indexPathSnapshot = ?,
            appliesToDescendants = ?, status = ?, updatedAt = ? WHERE id = ?`)
            .run(indexNodeId, binding.indexPath, binding.appliesToDescendants ? 1 : 0, bindingStatus,
              new Date().toISOString(), currentBinding.id);
        } else {
          db.prepare(`INSERT INTO KnowledgeDocumentBinding
            (id, documentId, indexNodeId, indexPathSnapshot, appliesToDescendants, status)
            VALUES (?, ?, ?, ?, ?, ?)`)
            .run(randomUUID(), documentId, indexNodeId, binding.indexPath,
              binding.appliesToDescendants ? 1 : 0, bindingStatus);
        }
      }
      let desiredActiveVersion: string | null = null;
      for (const version of document.versions) {
        const current = db.prepare("SELECT id FROM KnowledgeDocumentVersion WHERE documentId = ? AND sourceHash = ? ORDER BY versionNumber DESC LIMIT 1")
          .get(documentId, version.sourceHash) as { id: string } | undefined;
        const versionId = current?.id ?? randomUUID();
        const sourceName = `${version.sourceHash}${safeExtension(version.sourceFileName)}`;
        const localSource = path.join(getKnowledgeSourceRoot(), sourceName);
        const sourceFormat = version.sourceFormat ?? sourceFormatForFileName(version.sourceFileName);
        sourceTargets.set(version.sourcePath, localSource);
        const relativeSource = path.relative(process.cwd(), localSource).replace(/\\/g, "/");
        if (current) {
          db.prepare(`UPDATE KnowledgeDocumentVersion SET sourceFileName = ?, sourceMimeType = ?, sourceSizeBytes = ?, sourcePath = ?, sourceFormat = ?,
            rawText = ?, approvalMode = ?, processorEndpointId = ?, processorModel = ?, processorPromptHash = ?,
            processingMode = ?, processingRuleVersion = ?, error = ?, updatedAt = ? WHERE id = ?`)
            .run(version.sourceFileName, version.sourceMimeType, version.sourceSizeBytes, relativeSource, sourceFormat, version.rawText, version.approvalMode,
              version.processorEndpointId, version.processorModel, version.processorPromptHash, version.processingMode,
              version.processingRuleVersion, version.error, new Date().toISOString(), versionId);
          db.prepare("DELETE FROM KnowledgeChunkFts WHERE versionId = ?").run(versionId);
          db.prepare("DELETE FROM KnowledgeChunk WHERE versionId = ?").run(versionId);
        } else {
          const next = db.prepare("SELECT COALESCE(MAX(versionNumber), 0) + 1 AS value FROM KnowledgeDocumentVersion WHERE documentId = ?")
            .get(documentId) as { value: number };
          db.prepare(`INSERT INTO KnowledgeDocumentVersion
            (id, documentId, versionNumber, sourceFileName, sourceMimeType, sourceSizeBytes, sourceHash, sourcePath, rawText,
             status, approvalMode, processorEndpointId, processorModel, processorPromptHash, error, activatedAt,
             processingMode, processingRuleVersion, sourceFormat)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'INACTIVE', ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
            .run(versionId, documentId, next.value, version.sourceFileName, version.sourceMimeType, version.sourceSizeBytes,
              version.sourceHash, relativeSource, version.rawText, version.approvalMode, version.processorEndpointId,
              version.processorModel, version.processorPromptHash, version.error, version.activatedAt,
              version.processingMode, version.processingRuleVersion, sourceFormat);
        }
        for (const chunk of version.chunks) {
          const chunkId = randomUUID();
          const locator = chunk.locator ?? subtitleLocator({
            cueStart: chunk.sourceCueStart,
            cueEnd: chunk.sourceCueEnd,
            startMs: chunk.startMs,
            endMs: chunk.endMs,
          });
          db.prepare(`INSERT INTO KnowledgeChunk
            (id, versionId, ordinal, sourceCueStart, sourceCueEnd, startMs, endMs, originalText, cleanedText, topic, keywordsJson,
             locatorKind, locatorJson)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
            .run(chunkId, versionId, chunk.ordinal, chunk.sourceCueStart, chunk.sourceCueEnd, chunk.startMs, chunk.endMs,
              chunk.originalText, chunk.cleanedText, chunk.topic, JSON.stringify(chunk.keywords),
              locator.kind === "text" ? "TEXT" : "SUBTITLE", serializeKnowledgeLocator(locator));
          const insertKeyword = db.prepare("INSERT OR IGNORE INTO KnowledgeChunkKeyword (chunkId, keyword, normalizedKeyword) VALUES (?, ?, ?)");
          for (const keyword of expandKnowledgeKeywords(chunk.keywords)) {
            insertKeyword.run(chunkId, keyword.keyword, keyword.normalizedKeyword);
          }
          for (const embedding of chunk.embeddings) {
            const profileId = profileIds.get(embedding.profileId);
            if (profileId) embeddingTargets.set(embedding.path, { chunkId, profileId, byteLength: embedding.byteLength });
          }
        }
        if (version.status === "ACTIVE") desiredActiveVersion = versionId;
        else db.prepare("UPDATE KnowledgeDocumentVersion SET status = ? WHERE id = ?").run(version.status, versionId);
      }
      if (desiredActiveVersion) {
        db.prepare("UPDATE KnowledgeDocumentVersion SET status = 'INACTIVE' WHERE documentId = ? AND status = 'ACTIVE'").run(documentId);
        db.prepare("UPDATE KnowledgeDocumentVersion SET status = 'ACTIVE', activatedAt = ? WHERE id = ?")
          .run(new Date().toISOString(), desiredActiveVersion);
      }
    }
  })();
  return { sourceTargets, embeddingTargets, activeProfileId, restoredDocuments: knowledge.documents.length } satisfies KnowledgeRestoreState;
}

export async function restoreKnowledgeEntry(state: KnowledgeRestoreState, entryPath: string, buffer: Buffer) {
  const sourceTarget = state.sourceTargets.get(entryPath);
  if (sourceTarget) {
    const expectedHash = path.basename(sourceTarget, path.extname(sourceTarget));
    const actualHash = createHash("sha256").update(buffer).digest("hex");
    if (actualHash !== expectedHash) throw new Error(`Knowledge source hash mismatch: ${entryPath}`);
    await mkdir(/* turbopackIgnore: true */ path.dirname(sourceTarget), { recursive: true });
    try { await writeFile(/* turbopackIgnore: true */ sourceTarget, buffer, { flag: "wx" }); }
    catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
      const existingHash = createHash("sha256").update(await readFile(/* turbopackIgnore: true */ sourceTarget)).digest("hex");
      if (existingHash !== expectedHash) throw new Error(`Existing knowledge source hash mismatch: ${entryPath}`);
    }
    return true;
  }
  const embedding = state.embeddingTargets.get(entryPath);
  if (embedding) {
    if (buffer.length !== embedding.byteLength) throw new Error(`Knowledge embedding size mismatch: ${entryPath}`);
    knowledgeDb().prepare("INSERT OR REPLACE INTO KnowledgeChunkEmbedding (chunkId, profileId, embedding) VALUES (?, ?, ?)")
      .run(embedding.chunkId, embedding.profileId, buffer);
    return true;
  }
  return false;
}

export function finalizeKnowledgeRestore(state: KnowledgeRestoreState) {
  const db = knowledgeDb();
  if (state.activeProfileId) db.transaction(() => {
    db.prepare("UPDATE KnowledgeEmbeddingProfile SET status = 'RETIRED', updatedAt = ? WHERE status = 'ACTIVE' AND id <> ?")
      .run(new Date().toISOString(), state.activeProfileId);
    db.prepare("UPDATE KnowledgeEmbeddingProfile SET status = 'ACTIVE', error = NULL, updatedAt = ? WHERE id = ?")
      .run(new Date().toISOString(), state.activeProfileId);
  })();
  rebuildKnowledgeFts();
}
