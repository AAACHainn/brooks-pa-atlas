import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

import Database from "better-sqlite3";
import { load as loadSqliteVec } from "sqlite-vec";

import { AI_CONFIG_SETTING_KEY, defaultStoredAiConfig } from "@/lib/ai-config";
import type { PrismaClient } from "@/generated/prisma/client";

let prisma: PrismaClient;
let knowledge: InstanceType<typeof Database>;
let jobs: typeof import("@/lib/knowledge-import-jobs");
const originalFetch = globalThis.fetch;
const originalDatabaseUrl = process.env.DATABASE_URL;
const originalKnowledgeRoot = process.env.BROOKS_KNOWLEDGE_ROOT;

before(async () => {
  // Keep both databases and uploaded source files inside an isolated fixture.
  const directory = await mkdtemp(path.join(os.tmpdir(), "atlas-knowledge-import-"));
  const mainPath = path.join(directory, "main.db");
  process.env.DATABASE_URL = `file:${mainPath}`;
  process.env.BROOKS_KNOWLEDGE_ROOT = path.join(directory, "knowledge");
  const main = new Database(mainPath);
  const migrationRoot = path.join(process.cwd(), "prisma/migrations");
  for (const entry of (await readdir(migrationRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    main.exec(await readFile(path.join(migrationRoot, entry.name, "migration.sql"), "utf8"));
  }
  main.close();
  knowledge = new Database(":memory:");
  loadSqliteVec(knowledge);
  const knowledgeMigrationRoot = path.join(process.cwd(), "knowledge/migrations");
  for (const entry of (await readdir(knowledgeMigrationRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    knowledge.exec(await readFile(path.join(knowledgeMigrationRoot, entry.name, "migration.sql"), "utf8"));
  }
  (globalThis as typeof globalThis & { brooksKnowledgeDb?: typeof knowledge }).brooksKnowledgeDb = knowledge;
  prisma = (await import("@/lib/db")).prisma;
  jobs = await import("@/lib/knowledge-import-jobs");
  const config = defaultStoredAiConfig();
  config.endpoints = [{
    id: "mimo", name: "MiMo", provider: "custom", baseUrl: "https://api.xiaomimimo.com/v1",
    apiKey: "", useCustomUrls: false, chatCompletionsUrl: "", modelsUrl: "",
    models: ["mimo-v2.6-flash"], defaultModel: "mimo-v2.6-flash",
  }];
  config.activeEndpointId = "mimo";
  config.embeddingEndpoints = [{
    id: "embedding", name: "Embedding", provider: "custom", baseUrl: "https://embedding.test/v1",
    apiKey: "", useCustomUrls: false, embeddingsUrl: "", modelsUrl: "",
    models: ["embedding"], embeddingModel: "embedding",
  }];
  config.activeEmbeddingEndpointId = "embedding";
  await prisma.appSetting.create({ data: { key: AI_CONFIG_SETTING_KEY, value: JSON.stringify(config) } });
});

after(async () => {
  globalThis.fetch = originalFetch;
  knowledge?.close();
  delete (globalThis as typeof globalThis & { brooksKnowledgeDb?: typeof knowledge }).brooksKnowledgeDb;
  await prisma?.$disconnect();
  if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = originalDatabaseUrl;
  if (originalKnowledgeRoot === undefined) delete process.env.BROOKS_KNOWLEDGE_ROOT;
  else process.env.BROOKS_KNOWLEDGE_ROOT = originalKnowledgeRoot;
});

async function waitForJob(jobId: string) {
  const running = (globalThis as typeof globalThis & { brooksKnowledgeImportJobs?: Map<string, Promise<void>> })
    .brooksKnowledgeImportJobs?.get(jobId);
  if (running) await running;
  return jobs.knowledgeImportJobSnapshot(jobId)!;
}

test("MiMo imports activate complete chunks while failures persist their actual attempt counts", async () => {
  let mode: "success" | "reasoning" | "invalid" = "success";
  let chatCalls = 0;
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    if (Array.isArray(body.input)) {
      return Response.json({ data: body.input.map((_text: string, index: number) => ({ index, embedding: [1, 0, 0] })) });
    }
    chatCalls += 1;
    assert.deepEqual(body.thinking, { type: "disabled" });
    const content = mode === "invalid" ? "invalid JSON" : JSON.stringify({
      segments: [{ cueStart: 1, cueEnd: 2, topic: "Trading", keywords: ["Trend"] }],
    });
    return Response.json({
      choices: [{ message: { content, ...(mode === "reasoning" ? { reasoning_content: "Unexpected reasoning" } : {}) }, finish_reason: "stop" }],
      usage: { prompt_tokens: 200, completion_tokens: 50, completion_tokens_details: { reasoning_tokens: mode === "reasoning" ? 10 : 0 } },
    });
  };

  for (const scenario of ["success", "reasoning", "invalid"] as const) {
    mode = scenario;
    chatCalls = 0;
    const nodeId = `node-${scenario}`;
    await prisma.indexNode.create({ data: { id: nodeId, name: nodeId, path: nodeId } });
    const started = await jobs.createKnowledgeImportJob([{
      fileName: `${scenario}.srt`, mimeType: "text/plain", sourceType: "SUBTITLE",
      targetIndexNodeId: nodeId, targetIndexPath: nodeId,
      buffer: Buffer.from(`1\n00:00:01,000 --> 00:00:02,000\nTrading trends for ${scenario}.\n\n2\n00:00:03,000 --> 00:00:04,000\nRead the candles carefully.\n`),
    }], false, "AI");
    const finished = await waitForJob(started!.id);
    const item = finished.items[0];
    assert.equal(chatCalls, scenario === "invalid" ? 2 : 1);
    assert.equal(item.currentAttempt, scenario === "success" ? null : chatCalls);
    if (scenario === "success") {
      assert.equal(item.status, "COMPLETED");
      assert.equal(finished.status, "COMPLETED");
      assert.deepEqual(knowledge.prepare("SELECT status FROM KnowledgeDocumentVersion WHERE id = ?").get(item.versionId), { status: "ACTIVE" });
      const chunk = knowledge.prepare("SELECT sourceCueStart,sourceCueEnd,originalText FROM KnowledgeChunk WHERE versionId = ?").get(item.versionId) as { sourceCueStart: number; sourceCueEnd: number; originalText: string };
      assert.equal(chunk.sourceCueStart, 1);
      assert.equal(chunk.sourceCueEnd, 2);
      assert.match(chunk.originalText, /Read the candles carefully/);
      assert.equal((knowledge.prepare("SELECT COUNT(*) AS count FROM KnowledgeChunkEmbedding").get() as { count: number }).count, 1);
    } else {
      assert.equal(item.status, "FAILED");
      assert.equal(finished.status, "COMPLETED_WITH_ERRORS");
      assert.deepEqual(knowledge.prepare("SELECT retryCount FROM KnowledgeProcessingWindow WHERE itemId = ?").get(item.id), { retryCount: chatCalls - 1 });
      if (scenario === "invalid") {
        // A manual rerun starts a fresh attempt count, even after a previous full retry.
        mode = "reasoning";
        chatCalls = 0;
        jobs.decideKnowledgeImportItem(item.id, "retry");
        const rerun = await waitForJob(started!.id);
        assert.equal(chatCalls, 1);
        assert.equal(rerun.items[0].currentAttempt, 1);
        assert.deepEqual(knowledge.prepare("SELECT retryCount FROM KnowledgeProcessingWindow WHERE itemId = ?").get(item.id), { retryCount: 0 });
      }
    }
  }
});
