import { randomUUID } from "node:crypto";

import { createAiEmbeddings } from "@/lib/ai-client";
import { readStoredAiConfig } from "@/lib/ai-settings";
import { knowledgeDb, vectorBuffer } from "@/lib/knowledge-db";
import type { StoredAiConfig } from "@/lib/ai-config";

type ProfileRow = { id: string; endpointId: string; model: string; dimensions: number; status: string };

export const EMBEDDING_BATCH_SIZE = 20;

export function splitEmbeddingBatches(texts: string[], batchSize = EMBEDDING_BATCH_SIZE) {
  if (!Number.isInteger(batchSize) || batchSize < 1) throw new Error("Embedding batch size must be positive.");
  const batches: string[][] = [];
  for (let offset = 0; offset < texts.length; offset += batchSize) {
    batches.push(texts.slice(offset, offset + batchSize));
  }
  return batches;
}

export async function embedTexts(
  texts: string[],
  options: { onBatchCompleted?: (completed: number, total: number) => void | Promise<void>; signal?: AbortSignal;
    config?: StoredAiConfig; beforeRequest?: (texts: string[]) => void | Promise<void> } = {},
) {
  const config = options.config ?? await readStoredAiConfig();
  const endpoint = config.embeddingEndpoints.find((item) => item.id === config.activeEmbeddingEndpointId);
  if (!endpoint?.embeddingModel) throw new Error("尚未配置 Embedding 端点和模型。");
  const vectors: number[][] = [];
  const batches = splitEmbeddingBatches(texts);
  for (let index = 0; index < batches.length; index += 1) {
    options.signal?.throwIfAborted();
    await options.beforeRequest?.(batches[index]);
    options.signal?.throwIfAborted();
    vectors.push(...await createAiEmbeddings(endpoint, endpoint.embeddingModel, batches[index], { signal: options.signal }));
    await options.onBatchCompleted?.(index + 1, batches.length);
  }
  return { vectors, endpointId: endpoint.id, model: endpoint.embeddingModel, totalBatches: batches.length };
}

export function activeEmbeddingProfile(db = knowledgeDb()) {
  return db.prepare(
    "SELECT id, endpointId, model, dimensions, status FROM KnowledgeEmbeddingProfile WHERE status = 'ACTIVE' LIMIT 1",
  ).get() as ProfileRow | undefined;
}

export function ensureEmbeddingProfile(endpointId: string, model: string, dimensions: number) {
  const db = knowledgeDb();
  const active = activeEmbeddingProfile();
  if (active && active.endpointId === endpointId && active.model === model && active.dimensions === dimensions) {
    return active;
  }
  const existing = db.prepare(
    "SELECT id, endpointId, model, dimensions, status FROM KnowledgeEmbeddingProfile WHERE endpointId = ? AND model = ? AND dimensions = ? ORDER BY createdAt DESC LIMIT 1",
  ).get(endpointId, model, dimensions) as ProfileRow | undefined;
  if (active && (!existing || existing.id !== active.id)) {
    throw new Error("Embedding 模型与当前知识库 profile 不一致，请先在知识库管理中重建全部向量。");
  }
  if (existing) return existing;
  const profile = { id: randomUUID(), endpointId, model, dimensions, status: "ACTIVE" };
  db.prepare(
    "INSERT INTO KnowledgeEmbeddingProfile (id, endpointId, model, dimensions, status) VALUES (?, ?, ?, ?, 'ACTIVE')",
  ).run(profile.id, endpointId, model, dimensions);
  return profile;
}

export function storeChunkEmbeddings(
  entries: Array<{ chunkId: string; vector: number[] }>,
  profileId: string,
) {
  const db = knowledgeDb();
  const profileExists = db.prepare("SELECT 1 AS found FROM KnowledgeEmbeddingProfile WHERE id = ?");
  const chunkExists = db.prepare("SELECT 1 AS found FROM KnowledgeChunk WHERE id = ?");
  const insert = db.prepare(`INSERT INTO KnowledgeChunkEmbedding (chunkId, profileId, embedding)
    VALUES (?, ?, ?)
    ON CONFLICT(chunkId, profileId) DO UPDATE SET embedding = excluded.embedding`);
  db.transaction(() => {
    if (!profileExists.get(profileId)) {
      throw new Error("Embedding profile disappeared before vectors were stored. Retry the import after checking the active Embedding configuration.");
    }
    for (const entry of entries) {
      if (!chunkExists.get(entry.chunkId)) {
        throw new Error("Knowledge chunks changed while Embeddings were being generated. Retry the import; the completed AI windows will be reused.");
      }
      insert.run(entry.chunkId, profileId, vectorBuffer(entry.vector));
    }
  })();
}
