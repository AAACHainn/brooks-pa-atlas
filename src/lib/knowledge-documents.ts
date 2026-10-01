import { unlink } from "node:fs/promises";
import path from "node:path";

import { knowledgeDb, getKnowledgeSourceRoot } from "@/lib/knowledge-db";
import { prisma } from "@/lib/db";

function safeSourcePath(sourcePath: string) {
  const full = path.resolve(/* turbopackIgnore: true */ process.cwd(), sourcePath);
  const root = path.resolve(getKnowledgeSourceRoot());
  const relative = path.relative(root, full);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("字幕源文件路径越界。");
  return full;
}

export function listKnowledgeDocuments() {
  const db = knowledgeDb();
  const documents = db.prepare(`SELECT d.*,
    (SELECT id FROM KnowledgeDocumentVersion WHERE documentId = d.id AND status = 'ACTIVE' LIMIT 1) AS activeVersionId,
    (SELECT versionNumber FROM KnowledgeDocumentVersion WHERE documentId = d.id AND status = 'ACTIVE' LIMIT 1) AS activeVersionNumber,
    (SELECT COUNT(*) FROM KnowledgeChunk c JOIN KnowledgeDocumentVersion v ON v.id = c.versionId
      WHERE v.documentId = d.id AND v.status = 'ACTIVE') AS chunkCount
    FROM KnowledgeDocument d ORDER BY d.indexPathSnapshot, d.title`).all() as Array<Record<string, unknown>>;
  const versionStatement = db.prepare(`SELECT id, versionNumber, sourceFileName, sourceHash, status, approvalMode,
    processorModel, error, activatedAt, createdAt,
    (SELECT COUNT(*) FROM KnowledgeChunk WHERE versionId = KnowledgeDocumentVersion.id) AS chunkCount,
    (SELECT COUNT(*) FROM KnowledgeChunkEmbedding e
      JOIN KnowledgeChunk c ON c.id = e.chunkId
      WHERE c.versionId = KnowledgeDocumentVersion.id) AS vectorCount
    FROM KnowledgeDocumentVersion WHERE documentId = ? ORDER BY versionNumber DESC`);
  return documents.map((document) => ({
    ...document,
    appliesToDescendants: Boolean(document.appliesToDescendants),
    versions: versionStatement.all(document.id),
  }));
}

export async function reconcileKnowledgeBindings() {
  const nodes = await prisma.indexNode.findMany({ select: { id: true, path: true } });
  const paths = new Map(nodes.map((node) => [node.id, node.path]));
  const db = knowledgeDb();
  const documents = db.prepare("SELECT id, indexNodeId, indexPathSnapshot, bindingStatus FROM KnowledgeDocument WHERE indexNodeId IS NOT NULL")
    .all() as Array<{ id: string; indexNodeId: string; indexPathSnapshot: string; bindingStatus: string }>;
  db.transaction(() => {
    const update = db.prepare("UPDATE KnowledgeDocument SET indexPathSnapshot = ?, bindingStatus = ?, updatedAt = ? WHERE id = ?");
    for (const document of documents) {
      const currentPath = paths.get(document.indexNodeId);
      if (!currentPath) {
        if (document.bindingStatus !== "DISABLED") update.run(document.indexPathSnapshot, "ORPHANED", new Date().toISOString(), document.id);
      } else if (currentPath !== document.indexPathSnapshot || document.bindingStatus === "ORPHANED") {
        update.run(currentPath, document.bindingStatus === "DISABLED" ? "DISABLED" : "ACTIVE", new Date().toISOString(), document.id);
      }
    }
  })();
}

export function updateKnowledgeIndexSnapshots(nodes: Array<{ id: string; path: string }>) {
  const update = knowledgeDb().prepare(`UPDATE KnowledgeDocument SET indexPathSnapshot = ?,
    bindingStatus = CASE WHEN bindingStatus = 'ORPHANED' THEN 'ACTIVE' ELSE bindingStatus END,
    updatedAt = ? WHERE indexNodeId = ?`);
  knowledgeDb().transaction(() => {
    for (const node of nodes) update.run(node.path, new Date().toISOString(), node.id);
  })();
}

export function orphanKnowledgeDocuments(indexNodeIds: string[]) {
  if (!indexNodeIds.length) return;
  const statement = knowledgeDb().prepare(`UPDATE KnowledgeDocument SET bindingStatus = 'ORPHANED',
    updatedAt = ? WHERE indexNodeId = ? AND bindingStatus <> 'DISABLED'`);
  knowledgeDb().transaction(() => {
    for (const id of indexNodeIds) statement.run(new Date().toISOString(), id);
  })();
}

export function getKnowledgeVersionReview(versionId: string) {
  const db = knowledgeDb();
  const version = db.prepare(`SELECT v.*, d.title, d.lessonCode, d.indexPathSnapshot
    FROM KnowledgeDocumentVersion v JOIN KnowledgeDocument d ON d.id = v.documentId WHERE v.id = ?`)
    .get(versionId) as Record<string, unknown> | undefined;
  if (!version) return null;
  const chunks = db.prepare(`SELECT ordinal, sourceCueStart, sourceCueEnd, startMs, endMs,
    originalText, cleanedText, topic, keywordsJson FROM KnowledgeChunk WHERE versionId = ? ORDER BY ordinal`)
    .all(versionId) as Array<Record<string, unknown>>;
  return {
    ...version,
    chunks: chunks.map((chunk) => ({
      ...chunk,
      keywords: JSON.parse(String(chunk.keywordsJson)) as string[],
      keywordsJson: undefined,
    })),
  };
}

export function updateKnowledgeDocument(
  id: string,
  input: { indexNodeId?: string | null; indexPathSnapshot?: string; enabled?: boolean },
) {
  const db = knowledgeDb();
  const current = db.prepare("SELECT indexNodeId FROM KnowledgeDocument WHERE id = ?").get(id) as
    { indexNodeId: string | null } | undefined;
  if (!current) throw new Error("Knowledge document not found.");
  if (input.indexNodeId !== undefined) {
    db.prepare(`UPDATE KnowledgeDocument SET indexNodeId = ?, indexPathSnapshot = ?, bindingStatus = ?, updatedAt = ?
      WHERE id = ?`).run(input.indexNodeId, input.indexPathSnapshot ?? "", input.indexNodeId ? "ACTIVE" : "ORPHANED", new Date().toISOString(), id);
  }
  if (input.enabled !== undefined) {
    const effectiveIndexNodeId = input.indexNodeId !== undefined ? input.indexNodeId : current.indexNodeId;
    db.prepare("UPDATE KnowledgeDocument SET bindingStatus = ?, updatedAt = ? WHERE id = ?")
      .run(input.enabled ? (effectiveIndexNodeId ? "ACTIVE" : "ORPHANED") : "DISABLED", new Date().toISOString(), id);
  }
  return db.prepare("SELECT * FROM KnowledgeDocument WHERE id = ?").get(id);
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
      await unlink(safeSourcePath(entry.sourcePath));
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
      await unlink(safeSourcePath(deleted.sourcePath));
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
        replace(replace(c.keywordsJson, '[', ''), ']', ''), c.cleanedText
      FROM KnowledgeChunk c
      JOIN KnowledgeDocumentVersion v ON v.id = c.versionId
      JOIN KnowledgeDocument d ON d.id = v.documentId`).run();
  })();
}
