import { randomUUID } from "node:crypto";

import { createAiEmbeddings } from "@/lib/ai-client";
import { readStoredAiConfig } from "@/lib/ai-settings";
import { acquireHeavyTaskOrThrow, releaseHeavyTask } from "@/lib/background-task-coordinator";
import { knowledgeDb, vectorBuffer } from "@/lib/knowledge-db";
import { rebuildKnowledgeFts } from "@/lib/knowledge-documents";

const globalForKnowledgeMaintenance = globalThis as typeof globalThis & {
  brooksKnowledgeMaintenanceJobs?: Map<string, Promise<void>>;
};
const running = globalForKnowledgeMaintenance.brooksKnowledgeMaintenanceJobs ?? new Map<string, Promise<void>>();
globalForKnowledgeMaintenance.brooksKnowledgeMaintenanceJobs = running;

type JobRow = {
  id: string; kind: string; status: string; endpointId: string | null; model: string | null;
  profileId: string | null; totalItems: number; processedItems: number; error: string | null;
};

export function maintenanceSnapshot(id: string) {
  return knowledgeDb().prepare(`SELECT id, kind, status, endpointId, model, profileId,
    totalItems, processedItems, error, createdAt, updatedAt, finishedAt
    FROM KnowledgeMaintenanceJob WHERE id = ?`).get(id) as JobRow | undefined;
}

export async function knowledgeMaintenanceSummary() {
  const db = knowledgeDb();
  const config = await readStoredAiConfig();
  const endpoint = config.embeddingEndpoints.find((item) => item.id === config.activeEmbeddingEndpointId) ?? null;
  const profile = db.prepare(`SELECT id, endpointId, model, dimensions, updatedAt
    FROM KnowledgeEmbeddingProfile WHERE status = 'ACTIVE' LIMIT 1`).get() as {
      id: string; endpointId: string; model: string; dimensions: number; updatedAt: string;
    } | undefined;
  const activeChunks = db.prepare(`SELECT COUNT(*) AS count FROM KnowledgeChunk c
    JOIN KnowledgeDocumentVersion v ON v.id = c.versionId AND v.status = 'ACTIVE'
    JOIN KnowledgeDocument d ON d.id = v.documentId AND d.bindingStatus = 'ACTIVE'`).get() as { count: number };
  const activeVectors = profile
    ? db.prepare(`SELECT COUNT(*) AS count FROM KnowledgeChunkEmbedding e
        JOIN KnowledgeChunk c ON c.id = e.chunkId
        JOIN KnowledgeDocumentVersion v ON v.id = c.versionId AND v.status = 'ACTIVE'
        JOIN KnowledgeDocument d ON d.id = v.documentId AND d.bindingStatus = 'ACTIVE'
        WHERE e.profileId = ?`).get(profile.id) as { count: number }
    : { count: 0 };
  return {
    endpointName: endpoint?.name ?? null,
    provider: endpoint?.provider ?? null,
    configuredModel: endpoint?.embeddingModel ?? null,
    activeChunkCount: activeChunks.count,
    activeVectorCount: activeVectors.count,
    missingVectorCount: Math.max(0, activeChunks.count - activeVectors.count),
    activeProfile: profile ? {
      endpointId: profile.endpointId,
      model: profile.model,
      dimensions: profile.dimensions,
      updatedAt: profile.updatedAt,
    } : null,
    profileMatchesConfiguration: Boolean(
      profile && endpoint && profile.endpointId === endpoint.id && profile.model === endpoint.embeddingModel,
    ),
  };
}

async function runEmbeddingRebuild(id: string) {
  const db = knowledgeDb();
  const job = maintenanceSnapshot(id);
  if (!job?.profileId || !job.endpointId || !job.model) return;
  try {
    const config = await readStoredAiConfig();
    const endpoint = config.embeddingEndpoints.find((item) => item.id === job.endpointId);
    if (!endpoint || endpoint.embeddingModel !== job.model) throw new Error("Embedding 配置已在重建期间发生变化，请重新启动任务。");
    const chunks = db.prepare(`SELECT c.id, c.cleanedText FROM KnowledgeChunk c
      JOIN KnowledgeDocumentVersion v ON v.id = c.versionId AND v.status = 'ACTIVE'
      JOIN KnowledgeDocument d ON d.id = v.documentId AND d.bindingStatus = 'ACTIVE'
      ORDER BY c.id`).all() as Array<{ id: string; cleanedText: string }>;
    for (let offset = job.processedItems; offset < chunks.length; offset += 32) {
      const batch = chunks.slice(offset, offset + 32);
      const vectors = await createAiEmbeddings(endpoint, job.model, batch.map((chunk) => chunk.cleanedText));
      db.transaction(() => {
        const insert = db.prepare("INSERT OR REPLACE INTO KnowledgeChunkEmbedding (chunkId, profileId, embedding) VALUES (?, ?, ?)");
        batch.forEach((chunk, index) => insert.run(chunk.id, job.profileId, vectorBuffer(vectors[index])));
        if (offset === 0) db.prepare("UPDATE KnowledgeEmbeddingProfile SET dimensions = ?, updatedAt = ? WHERE id = ?")
          .run(vectors[0]?.length ?? 0, new Date().toISOString(), job.profileId);
        db.prepare("UPDATE KnowledgeMaintenanceJob SET processedItems = ?, updatedAt = ? WHERE id = ?")
          .run(offset + batch.length, new Date().toISOString(), id);
      })();
    }
    db.transaction(() => {
      db.prepare("UPDATE KnowledgeEmbeddingProfile SET status = 'RETIRED', updatedAt = ? WHERE status = 'ACTIVE'")
        .run(new Date().toISOString());
      db.prepare("UPDATE KnowledgeEmbeddingProfile SET status = 'ACTIVE', error = NULL, updatedAt = ? WHERE id = ?")
        .run(new Date().toISOString(), job.profileId);
      db.prepare("UPDATE KnowledgeMaintenanceJob SET activeKey = NULL, status = 'COMPLETED', finishedAt = ?, updatedAt = ? WHERE id = ?")
        .run(new Date().toISOString(), new Date().toISOString(), id);
    })();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    db.transaction(() => {
      db.prepare("UPDATE KnowledgeEmbeddingProfile SET status = 'FAILED', error = ?, updatedAt = ? WHERE id = ?")
        .run(message, new Date().toISOString(), job.profileId);
      db.prepare("UPDATE KnowledgeMaintenanceJob SET activeKey = NULL, status = 'FAILED', error = ?, finishedAt = ?, updatedAt = ? WHERE id = ?")
        .run(message, new Date().toISOString(), new Date().toISOString(), id);
    })();
  }
}

export function startMaintenanceJob(id: string) {
  if (running.has(id)) return;
  acquireHeavyTaskOrThrow("knowledge-embeddings", id);
  const promise = runEmbeddingRebuild(id).finally(() => {
    running.delete(id);
    releaseHeavyTask("knowledge-embeddings", id);
  });
  running.set(id, promise);
}

export async function createEmbeddingRebuildJob() {
  const config = await readStoredAiConfig();
  const endpoint = config.embeddingEndpoints.find((item) => item.id === config.activeEmbeddingEndpointId);
  if (!endpoint?.embeddingModel) throw new Error("尚未配置启用的 Embedding 端点和模型。");
  const db = knowledgeDb();
  if (db.prepare("SELECT id FROM KnowledgeMaintenanceJob WHERE activeKey = 'GLOBAL'").get()) {
    throw new Error("已有知识库维护任务正在运行。");
  }
  if (db.prepare("SELECT id FROM KnowledgeImportJob WHERE activeKey = 'GLOBAL'").get()) {
    throw new Error("知识导入正在运行，请等待完成后再重建向量。");
  }
  const id = randomUUID();
  acquireHeavyTaskOrThrow("knowledge-embeddings", id);
  const profileId = randomUUID();
  try {
    const count = db.prepare(`SELECT COUNT(*) AS count FROM KnowledgeChunk c
      JOIN KnowledgeDocumentVersion v ON v.id = c.versionId AND v.status = 'ACTIVE'
      JOIN KnowledgeDocument d ON d.id = v.documentId AND d.bindingStatus = 'ACTIVE'`).get() as { count: number };
    db.transaction(() => {
      db.prepare(`INSERT INTO KnowledgeEmbeddingProfile
        (id, endpointId, model, dimensions, status) VALUES (?, ?, ?, 0, 'BUILDING')`)
        .run(profileId, endpoint.id, endpoint.embeddingModel);
      db.prepare(`INSERT INTO KnowledgeMaintenanceJob
        (id, activeKey, kind, status, endpointId, model, profileId, totalItems)
        VALUES (?, 'GLOBAL', 'EMBEDDINGS', 'RUNNING', ?, ?, ?, ?)`)
        .run(id, endpoint.id, endpoint.embeddingModel, profileId, count.count);
    })();
  } catch (error) {
    releaseHeavyTask("knowledge-embeddings", id);
    throw error;
  }
  startMaintenanceJob(id);
  return maintenanceSnapshot(id);
}

export function rebuildFtsNow() {
  rebuildKnowledgeFts();
  return { ok: true };
}

export function resumeInterruptedKnowledgeMaintenance() {
  const rows = knowledgeDb().prepare("SELECT id FROM KnowledgeMaintenanceJob WHERE activeKey = 'GLOBAL' AND status = 'RUNNING'")
    .all() as Array<{ id: string }>;
  for (const row of rows) {
    try { startMaintenanceJob(row.id); } catch { break; }
  }
}
