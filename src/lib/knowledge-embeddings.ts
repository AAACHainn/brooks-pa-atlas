import { randomUUID } from "node:crypto";

import { createAiEmbeddings } from "@/lib/ai-client";
import { readStoredAiConfig } from "@/lib/ai-settings";
import { knowledgeDb, vectorBuffer } from "@/lib/knowledge-db";

type ProfileRow = { id: string; endpointId: string; model: string; dimensions: number; status: string };

export async function embedTexts(texts: string[]) {
  const config = await readStoredAiConfig();
  const endpoint = config.embeddingEndpoints.find((item) => item.id === config.activeEmbeddingEndpointId);
  if (!endpoint?.embeddingModel) throw new Error("尚未配置 Embedding 端点和模型。");
  const vectors: number[][] = [];
  for (let offset = 0; offset < texts.length; offset += 32) {
    vectors.push(...await createAiEmbeddings(endpoint, endpoint.embeddingModel, texts.slice(offset, offset + 32)));
  }
  return { vectors, endpointId: endpoint.id, model: endpoint.embeddingModel };
}

export function activeEmbeddingProfile() {
  return knowledgeDb().prepare(
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
  const insert = knowledgeDb().prepare(
    "INSERT OR REPLACE INTO KnowledgeChunkEmbedding (chunkId, profileId, embedding) VALUES (?, ?, ?)",
  );
  knowledgeDb().transaction(() => {
    for (const entry of entries) insert.run(entry.chunkId, profileId, vectorBuffer(entry.vector));
  })();
}
