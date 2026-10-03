import { randomUUID } from "node:crypto";
import { unlink } from "node:fs/promises";
import path from "node:path";

import { knowledgeDb, getKnowledgeSourceRoot } from "@/lib/knowledge-db";
import { prisma } from "@/lib/db";
import { parseKnowledgeLocator } from "@/lib/knowledge-source";

function safeSourcePath(sourcePath: string) {
  const full = path.resolve(/* turbopackIgnore: true */ process.cwd(), sourcePath);
  const root = path.resolve(getKnowledgeSourceRoot());
  const relative = path.relative(root, full);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("资料源文件路径越界。");
  return full;
}

export class KnowledgeBindingConflictError extends Error {}

export function listKnowledgeDocuments() {
  const db = knowledgeDb();
  const documents = db.prepare(`SELECT d.*,
    b.id AS bindingId, b.indexNodeId, b.indexPathSnapshot, b.appliesToDescendants,
    b.status AS bindingStatus,
    (SELECT id FROM KnowledgeDocumentVersion WHERE documentId = d.id AND status = 'ACTIVE' LIMIT 1) AS activeVersionId,
    (SELECT versionNumber FROM KnowledgeDocumentVersion WHERE documentId = d.id AND status = 'ACTIVE' LIMIT 1) AS activeVersionNumber,
    (SELECT COUNT(*) FROM KnowledgeChunk c JOIN KnowledgeDocumentVersion v ON v.id = c.versionId
      WHERE v.documentId = d.id AND v.status = 'ACTIVE') AS chunkCount
    FROM KnowledgeDocument d
    LEFT JOIN KnowledgeDocumentBinding b ON b.documentId = d.id
    ORDER BY COALESCE(b.indexPathSnapshot, ''), d.title`).all() as Array<Record<string, unknown>>;
  const versionStatement = db.prepare(`SELECT id, versionNumber, sourceFileName, sourceHash, status, approvalMode,
    processingMode, processorModel, sourceFormat, error, activatedAt, createdAt,
    (SELECT COUNT(*) FROM KnowledgeChunk WHERE versionId = KnowledgeDocumentVersion.id) AS chunkCount,
    (SELECT COUNT(*) FROM KnowledgeChunkEmbedding e
      JOIN KnowledgeChunk c ON c.id = e.chunkId
      WHERE c.versionId = KnowledgeDocumentVersion.id) AS vectorCount
    FROM KnowledgeDocumentVersion WHERE documentId = ? ORDER BY versionNumber DESC`);
  return documents.map((document) => ({
    ...document,
    enabled: Boolean(document.enabled),
    binding: document.bindingId ? {
      id: document.bindingId,
      indexNodeId: document.indexNodeId,
      indexPathSnapshot: document.indexPathSnapshot,
      appliesToDescendants: Boolean(document.appliesToDescendants),
      status: document.bindingStatus,
    } : null,
    bindingId: undefined,
    indexNodeId: undefined,
    indexPathSnapshot: undefined,
    appliesToDescendants: undefined,
    bindingStatus: undefined,
    versions: versionStatement.all(document.id),
  }));
}

export async function reconcileKnowledgeBindings() {
  const nodes = await prisma.indexNode.findMany({ select: { id: true, path: true } });
  const paths = new Map(nodes.map((node) => [node.id, node.path]));
  const db = knowledgeDb();
  const bindings = db.prepare(`SELECT id, indexNodeId, indexPathSnapshot, status
    FROM KnowledgeDocumentBinding WHERE indexNodeId IS NOT NULL`)
    .all() as Array<{ id: string; indexNodeId: string; indexPathSnapshot: string; status: string }>;
  db.transaction(() => {
    const update = db.prepare(`UPDATE KnowledgeDocumentBinding
      SET indexPathSnapshot = ?, status = ?, updatedAt = ? WHERE id = ?`);
    for (const binding of bindings) {
      const currentPath = paths.get(binding.indexNodeId);
      if (!currentPath) {
        if (binding.status !== "ORPHANED") update.run(binding.indexPathSnapshot, "ORPHANED", new Date().toISOString(), binding.id);
      } else if (currentPath !== binding.indexPathSnapshot || binding.status === "ORPHANED") {
        update.run(currentPath, "ACTIVE", new Date().toISOString(), binding.id);
      }
    }
  })();
}

export function updateKnowledgeIndexSnapshots(nodes: Array<{ id: string; path: string }>) {
  const update = knowledgeDb().prepare(`UPDATE KnowledgeDocumentBinding SET indexPathSnapshot = ?,
    status = 'ACTIVE',
    updatedAt = ? WHERE indexNodeId = ?`);
  knowledgeDb().transaction(() => {
    for (const node of nodes) update.run(node.path, new Date().toISOString(), node.id);
  })();
}

export function orphanKnowledgeDocuments(indexNodeIds: string[]) {
  if (!indexNodeIds.length) return;
  const statement = knowledgeDb().prepare(`UPDATE KnowledgeDocumentBinding SET status = 'ORPHANED',
    updatedAt = ? WHERE indexNodeId = ?`);
  knowledgeDb().transaction(() => {
    for (const id of indexNodeIds) statement.run(new Date().toISOString(), id);
  })();
}

export function getKnowledgeVersionReview(versionId: string) {
  const db = knowledgeDb();
  const version = db.prepare(`SELECT v.*, d.title, d.lessonCode, d.sourceType, b.indexPathSnapshot
    FROM KnowledgeDocumentVersion v JOIN KnowledgeDocument d ON d.id = v.documentId
    LEFT JOIN KnowledgeDocumentBinding b ON b.documentId = d.id WHERE v.id = ?`)
    .get(versionId) as Record<string, unknown> | undefined;
  if (!version) return null;
  const chunks = db.prepare(`SELECT ordinal, sourceCueStart, sourceCueEnd, startMs, endMs,
    originalText, cleanedText, topic, keywordsJson, locatorKind, locatorJson
    FROM KnowledgeChunk WHERE versionId = ? ORDER BY ordinal`)
    .all(versionId) as Array<Record<string, unknown>>;
  return {
    ...version,
    chunks: chunks.map((chunk) => ({
      ...chunk,
      locator: parseKnowledgeLocator(String(chunk.locatorJson), {
        cueStart: Number(chunk.sourceCueStart),
        cueEnd: Number(chunk.sourceCueEnd),
        startMs: chunk.startMs === null ? null : Number(chunk.startMs),
        endMs: chunk.endMs === null ? null : Number(chunk.endMs),
      }),
      keywords: JSON.parse(String(chunk.keywordsJson)) as string[],
      keywordsJson: undefined,
    })),
  };
}

export function updateKnowledgeDocument(
  id: string,
  input: { enabled?: boolean },
) {
  const db = knowledgeDb();
  const current = db.prepare("SELECT id FROM KnowledgeDocument WHERE id = ?").get(id) as { id: string } | undefined;
  if (!current) throw new Error("Knowledge document not found.");
  if (input.enabled !== undefined) {
    db.prepare("UPDATE KnowledgeDocument SET enabled = ?, updatedAt = ? WHERE id = ?")
      .run(input.enabled ? 1 : 0, new Date().toISOString(), id);
  }
  return db.prepare("SELECT * FROM KnowledgeDocument WHERE id = ?").get(id);
}

export function putKnowledgeDocumentBinding(
  documentId: string,
  input: { indexNodeId: string; indexPathSnapshot: string; appliesToDescendants: boolean },
) {
  const db = knowledgeDb();
  const document = db.prepare("SELECT id FROM KnowledgeDocument WHERE id = ?").get(documentId);
  if (!document) throw new Error("Knowledge document not found.");
  const occupied = db.prepare(`SELECT documentId FROM KnowledgeDocumentBinding
    WHERE indexNodeId = ? AND documentId <> ?`).get(input.indexNodeId, documentId) as { documentId: string } | undefined;
  if (occupied) throw new KnowledgeBindingConflictError("Target index node already has a knowledge document.");
  const current = db.prepare("SELECT id FROM KnowledgeDocumentBinding WHERE documentId = ?")
    .get(documentId) as { id: string } | undefined;
  if (current) {
    db.prepare(`UPDATE KnowledgeDocumentBinding SET indexNodeId = ?, indexPathSnapshot = ?,
      appliesToDescendants = ?, status = 'ACTIVE', updatedAt = ? WHERE id = ?`)
      .run(input.indexNodeId, input.indexPathSnapshot, input.appliesToDescendants ? 1 : 0,
        new Date().toISOString(), current.id);
  } else {
    db.prepare(`INSERT INTO KnowledgeDocumentBinding
      (id, documentId, indexNodeId, indexPathSnapshot, appliesToDescendants, status)
      VALUES (?, ?, ?, ?, ?, 'ACTIVE')`)
      .run(randomUUID(), documentId, input.indexNodeId, input.indexPathSnapshot,
        input.appliesToDescendants ? 1 : 0);
  }
  return db.prepare("SELECT * FROM KnowledgeDocumentBinding WHERE documentId = ?").get(documentId);
}

export function patchKnowledgeDocumentBinding(documentId: string, appliesToDescendants: boolean) {
  const db = knowledgeDb();
  const result = db.prepare(`UPDATE KnowledgeDocumentBinding SET appliesToDescendants = ?, updatedAt = ?
    WHERE documentId = ?`).run(appliesToDescendants ? 1 : 0, new Date().toISOString(), documentId);
  if (!result.changes) throw new Error("Knowledge document binding not found.");
  return db.prepare("SELECT * FROM KnowledgeDocumentBinding WHERE documentId = ?").get(documentId);
}

export function deleteKnowledgeDocumentBinding(documentId: string) {
  const result = knowledgeDb().prepare("DELETE FROM KnowledgeDocumentBinding WHERE documentId = ?").run(documentId);
  if (!result.changes) throw new Error("Knowledge document binding not found.");
  return { ok: true };
}

export async function deleteKnowledgeDocument(id: string) {
  const db = knowledgeDb();
  const paths = db.prepare("SELECT DISTINCT sourcePath FROM KnowledgeDocumentVersion WHERE documentId = ?").all(id) as Array<{ sourcePath: string }>;
  db.transaction(() => {
    const versions = db.prepare("SELECT id FROM KnowledgeDocumentVersion WHERE documentId = ?").all(id) as Array<{ id: string }>;
    for (const version of versions) db.prepare("DELETE FROM KnowledgeChunkFts WHERE versionId = ?").run(version.id);
    const result = db.prepare("DELETE FROM KnowledgeDocument WHERE id = ?").run(id);
    if (!result.changes) throw new Error("Knowledge document not found.");
  })();
  for (const entry of paths) {
    const remaining = db.prepare("SELECT 1 FROM KnowledgeDocumentVersion WHERE sourcePath = ? LIMIT 1").get(entry.sourcePath);
    if (remaining) continue;
    try {
      await unlink(/* turbopackIgnore: true */ safeSourcePath(entry.sourcePath));
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
    }
  }
}

export function activateKnowledgeVersion(documentId: string, versionId: string) {
  const db = knowledgeDb();
  db.transaction(() => {
    const version = db.prepare("SELECT id, status FROM KnowledgeDocumentVersion WHERE id = ? AND documentId = ?")
      .get(versionId, documentId) as { id: string; status: string } | undefined;
    if (!version) throw new Error("Knowledge version not found.");
    if (version.status !== "INACTIVE") throw new Error("Only a completed inactive version can be activated.");
    const chunkCount = db.prepare("SELECT COUNT(*) AS count FROM KnowledgeChunk WHERE versionId = ?")
      .get(versionId) as { count: number };
    if (!chunkCount.count) throw new Error("Cannot activate an empty knowledge version.");
    db.prepare("UPDATE KnowledgeDocumentVersion SET status = 'INACTIVE', updatedAt = ? WHERE documentId = ? AND status = 'ACTIVE'")
      .run(new Date().toISOString(), documentId);
    db.prepare("UPDATE KnowledgeDocumentVersion SET status = 'ACTIVE', error = NULL, activatedAt = ?, updatedAt = ? WHERE id = ?")
      .run(new Date().toISOString(), new Date().toISOString(), versionId);
  })();
}

export async function deleteKnowledgeVersion(documentId: string, versionId: string) {
  const db = knowledgeDb();
  const deleted = db.transaction(() => {
    const version = db.prepare(`SELECT id, status, sourcePath FROM KnowledgeDocumentVersion
      WHERE id = ? AND documentId = ?`).get(versionId, documentId) as { id: string; status: string; sourcePath: string } | undefined;
    if (!version) throw new Error("Knowledge version not found.");
    if (!["INACTIVE", "FAILED", "REJECTED"].includes(version.status)) {
      throw new Error("只能删除已停用、失败或已拒绝的历史版本。");
    }
    const chunkCount = db.prepare("SELECT COUNT(*) AS count FROM KnowledgeChunk WHERE versionId = ?")
      .get(versionId) as { count: number };
    const vectorCount = db.prepare(`SELECT COUNT(*) AS count FROM KnowledgeChunkEmbedding e
      JOIN KnowledgeChunk c ON c.id = e.chunkId WHERE c.versionId = ?`).get(versionId) as { count: number };
    db.prepare("DELETE FROM KnowledgeChunkFts WHERE versionId = ?").run(versionId);
    db.prepare("DELETE FROM KnowledgeDocumentVersion WHERE id = ?").run(versionId);
    const remainingVersions = db.prepare("SELECT COUNT(*) AS count FROM KnowledgeDocumentVersion WHERE documentId = ?")
      .get(documentId) as { count: number };
    if (remainingVersions.count === 0) db.prepare("DELETE FROM KnowledgeDocument WHERE id = ?").run(documentId);
    return {
      deletedChunks: chunkCount.count,
      deletedVectors: vectorCount.count,
      removedEmptyDocument: remainingVersions.count === 0,
      sourcePath: version.sourcePath,
    };
  })();
  const remainingSourceReference = db.prepare("SELECT 1 FROM KnowledgeDocumentVersion WHERE sourcePath = ? LIMIT 1")
    .get(deleted.sourcePath);
  if (!remainingSourceReference) {
    try {
      await unlink(/* turbopackIgnore: true */ safeSourcePath(deleted.sourcePath));
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
    }
  }
  return {
    deletedChunks: deleted.deletedChunks,
    deletedVectors: deleted.deletedVectors,
    removedEmptyDocument: deleted.removedEmptyDocument,
  };
}

export function rebuildKnowledgeFts() {
  const db = knowledgeDb();
  db.transaction(() => {
    db.prepare("DELETE FROM KnowledgeChunkFts").run();
    db.prepare(`INSERT INTO KnowledgeChunkFts
      (chunkId, documentId, versionId, title, lessonCode, topic, keywords, cleanedText)
      SELECT c.id, v.documentId, v.id, d.title, COALESCE(d.lessonCode, ''), c.topic,
        replace(replace(c.keywordsJson, '[', ''), ']', ''),
        CASE WHEN c.locatorKind = 'TEXT'
          THEN replace(replace(replace(COALESCE(json_extract(c.locatorJson, '$.headingPath'), ''), '[', ''), ']', ''), '"', '') || char(10) || c.cleanedText
          ELSE c.cleanedText END
      FROM KnowledgeChunk c
      JOIN KnowledgeDocumentVersion v ON v.id = c.versionId
      JOIN KnowledgeDocument d ON d.id = v.documentId`).run();
  })();
}
