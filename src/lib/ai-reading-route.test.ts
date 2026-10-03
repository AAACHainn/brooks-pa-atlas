import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, unlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import Database from "better-sqlite3";
import { load as loadSqliteVec } from "sqlite-vec";
import sharp from "sharp";
import { AI_CONFIG_SETTING_KEY, defaultStoredAiConfig } from "@/lib/ai-config";
import { acquireHeavyTask, currentHeavyTask, releaseHeavyTask } from "@/lib/background-task-coordinator";
import type { PrismaClient } from "@/generated/prisma/client";
import { vectorBuffer } from "@/lib/knowledge-db";

let prisma: PrismaClient;
let messagesPost: typeof import("@/app/api/ai/reading-companion/conversations/[id]/messages/route").POST;
let settingsPut: typeof import("@/app/api/settings/ai/route").PUT;
let settingsGet: typeof import("@/app/api/settings/ai/route").GET;
let directory: string;
let knowledge: InstanceType<typeof Database>;
const originalFetch = globalThis.fetch;
const config = defaultStoredAiConfig();
config.endpoints = [{ id: "mock", name: "mock", provider: "custom", baseUrl: "http://mock.invalid/v1", apiKey: "",
  useCustomUrls: false, chatCompletionsUrl: "", modelsUrl: "", models: ["vision"], defaultModel: "vision" }];
config.activeEndpointId = "mock";

before(async () => {
  // All database and image writes are isolated from the user's library.
  directory = await mkdtemp(path.join(os.tmpdir(), "atlas-reading-route-"));
  process.env.DATABASE_URL = `file:${path.join(directory, "main.db")}`;
  process.env.BROOKS_LIBRARY_ROOT = directory;
  const main = new Database(path.join(directory, "main.db"));
  const migrationRoot = path.join(process.cwd(), "prisma/migrations");
  for (const entry of (await readdir(migrationRoot, { withFileTypes: true })).filter((entry) => entry.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    main.exec(await readFile(path.join(migrationRoot, entry.name, "migration.sql"), "utf8"));
  }
  main.close();
  knowledge = new Database(":memory:");
  loadSqliteVec(knowledge);
  for (const name of ["20260930000000_init", "20261002000000_generalize_knowledge_sources"]) {
    knowledge.exec(await readFile(path.join(process.cwd(), "knowledge/migrations", name, "migration.sql"), "utf8"));
  }
  (globalThis as typeof globalThis & { brooksKnowledgeDb?: typeof knowledge }).brooksKnowledgeDb = knowledge;
  prisma = (await import("@/lib/db")).prisma;
  await prisma.indexNode.create({ data: { id: "node", name: "19A", path: "19A" } });
  await prisma.indexNode.create({ data: { id: "unbound-node", name: "01", path: "01" } });
  await sharp({ create: { width: 32, height: 32, channels: 3, background: "white" } }).png().toFile(path.join(directory, "chart.png"));
  const libraryPath = path.relative(process.cwd(), path.join(directory, "chart.png"));
  await prisma.chartImage.create({ data: { id: "image", originalName: "19A.png", title: "Support and resistance", libraryPath, hash: "a".repeat(64), mimeType: "image/png", sizeBytes: 100, indexNodeId: "node" } });
  for (const id of ["current", "related"]) {
    knowledge.prepare("INSERT INTO KnowledgeDocument(id,title,lessonCode,sourceType,enabled) VALUES (?,?,?,'SUBTITLE',1)").run(id, id, id === "current" ? "19A" : "20A");
    knowledge.prepare(`INSERT INTO KnowledgeDocumentVersion(id,documentId,versionNumber,sourceFileName,sourceMimeType,sourceSizeBytes,sourceHash,sourcePath,rawText,status,sourceFormat)
      VALUES (?,?,1,'lesson.srt','text/plain',1,?,'source','raw','ACTIVE','SRT')`).run(`v-${id}`, id, (id === "current" ? "b" : "c").repeat(64));
    knowledge.prepare("INSERT INTO KnowledgeDocumentBinding(id,documentId,indexNodeId,indexPathSnapshot,status) VALUES (?,?,?,?,'ACTIVE')").run(`bind-${id}`, id, id === "current" ? "node" : "other-node", id);
    for (let i = 0; i < 12; i++) {
      const text = `支撑与阻力 ${id} 第${i}段`;
      knowledge.prepare(`INSERT INTO KnowledgeChunk(id,versionId,ordinal,sourceCueStart,sourceCueEnd,originalText,cleanedText,topic,keywordsJson,locatorJson)
        VALUES (?,?,?,?,?,?,?,'支撑','["支撑"]',?)`).run(`${id}-${i}`, `v-${id}`, i, i + 1, i + 1, text, text,
          JSON.stringify({ v: 1, kind: "subtitle", cueStart: i + 1, cueEnd: i + 1, startMs: i * 1_000, endMs: i * 1_000 + 999 }));
      knowledge.prepare("INSERT INTO KnowledgeChunkFts(chunkId,documentId,versionId,title,lessonCode,topic,keywords,cleanedText) VALUES (?,?,?,?,?,'支撑','支撑',?)").run(`${id}-${i}`, id, `v-${id}`, id, id === "current" ? "19A" : "20A", text);
      knowledge.prepare("INSERT INTO KnowledgeChunkKeyword(chunkId,keyword,normalizedKeyword) VALUES (?,'支撑','支撑')").run(`${id}-${i}`);
    }
  }
  messagesPost = (await import("@/app/api/ai/reading-companion/conversations/[id]/messages/route")).POST;
  const settings = await import("@/app/api/settings/ai/route");
  settingsPut = settings.PUT; settingsGet = settings.GET;
  await saveConfig();
});

after(async () => {
  globalThis.fetch = originalFetch;
  knowledge?.close();
  delete (globalThis as typeof globalThis & { brooksKnowledgeDb?: typeof knowledge }).brooksKnowledgeDb;
  await prisma?.$disconnect();
  // Remove only the two files this fixture created, using explicit individual paths.
  await unlink(path.join(directory, "chart.png"));
  await unlink(path.join(directory, "main.db"));
});

async function saveConfig() {
  const response = await settingsPut(new Request("http://atlas.test/api/settings/ai", { method: "PUT", body: JSON.stringify(config) }));
  assert.equal(response.status, 200);
  return response.json();
}
async function conversation() { return prisma.aiReadingConversation.create({ data: {} }); }
function request(mode?: "quick" | "deep", signal?: AbortSignal, content = "解释支撑与阻力") {
  return new Request("http://atlas.test/messages", { method: "POST", signal, body: JSON.stringify({ imageId: "image", content, ...(mode ? { answerMode: mode } : {}) }) });
}
function reply(text: string) { return Response.json({ choices: [{ message: { content: text } }] }); }
function events(text: string) { return text.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line)); }

test("legacy POST uses quick retrieval, eight sources, current priority and one answer call", async () => {
  const item = await conversation();
  let calls = 0;
  globalThis.fetch = async () => { calls++; return reply("说明 [K1]"); };
  const response = await messagesPost(request(), { params: Promise.resolve({ id: item.id }) });
  const streamed = events(await response.text());
  const done = streamed.find((event) => event.type === "done");
  assert.equal(calls, 1);
  assert.equal(done.assistantMessage.answerMode, "quick");
  assert.equal(done.assistantMessage.knowledge.sources.length, 8);
  assert.ok(done.assistantMessage.knowledge.sources.filter((source: { scope: string }) => source.scope === "current").length >= 4);
  assert.equal(streamed.some((event) => event.type === "progress"), false);
});

test("unbound image context cannot pull unrelated library excerpts into quick answers", async () => {
  const previous = await prisma.chartImage.findUniqueOrThrow({ where: { id: "image" }, select: { indexNodeId: true, ocrText: true } });
  await prisma.chartImage.update({ where: { id: "image" }, data: { indexNodeId: "unbound-node", ocrText: "支撑与阻力 current 第19A课" } });
  try {
    for (const question of ["当前课程内容主要讲的是什么？", "请翻译这张图片上的内容", "怎么做西红柿炒鸡蛋？"]) {
      const item = await conversation();
      let calls = 0;
      globalThis.fetch = async (_url, init) => {
        calls++;
        assert.match(JSON.stringify(JSON.parse(String(init?.body)).messages), /未找到符合相关性要求的知识库资料/);
        return reply("根据图片回答");
      };
      const response = await messagesPost(request("quick", undefined, question), { params: Promise.resolve({ id: item.id }) });
      const done = events(await response.text()).find((event) => event.type === "done");
      assert.equal(calls, 1);
      assert.deepEqual(done.assistantMessage.knowledge.sources, []);
      assert.equal(done.assistantMessage.knowledge.hasCurrentBinding, false);
      assert.equal(done.assistantMessage.knowledge.warning, "no_relevant_evidence");
    }
    // An explicitly relevant question can still use the full library without a binding.
    const item = await conversation();
    globalThis.fetch = async () => reply("相关解释 [K1]");
    const response = await messagesPost(request(), { params: Promise.resolve({ id: item.id }) });
    const done = events(await response.text()).find((event) => event.type === "done");
    assert.equal(done.assistantMessage.knowledge.sources.length, 8);
    assert.equal(done.assistantMessage.knowledge.warning, "no_current_binding");
    // A vague local request can use image context once an actual binding exists.
    await prisma.chartImage.update({ where: { id: "image" }, data: { indexNodeId: "node" } });
    const bound = await conversation();
    const boundResponse = await messagesPost(request("quick", undefined, "请解释当前图片"), { params: Promise.resolve({ id: bound.id }) });
    const boundDone = events(await boundResponse.text()).find((event) => event.type === "done");
    assert.ok(boundDone.assistantMessage.knowledge.sources.length > 0);
    assert.ok(boundDone.assistantMessage.knowledge.sources.every((source: { scope: string }) => source.scope === "current"));
  } finally { await prisma.chartImage.update({ where: { id: "image" }, data: previous }); }
});

test("quick and deep reject distant vectors, keep real semantic matches and never pad to eight", async () => {
  const previous = await prisma.chartImage.findUniqueOrThrow({ where: { id: "image" }, select: { indexNodeId: true, ocrText: true } });
  await prisma.chartImage.update({ where: { id: "image" }, data: { indexNodeId: "unbound-node", ocrText: "支撑与阻力" } });
  config.embeddingEndpoints = [{ id: "embed-mock", name: "mock", provider: "custom", baseUrl: "http://mock.invalid/v1", apiKey: "",
    useCustomUrls: false, embeddingsUrl: "", modelsUrl: "", models: ["embed"], embeddingModel: "embed" }];
  config.activeEmbeddingEndpointId = "embed-mock";
  await saveConfig();
  knowledge.prepare("INSERT INTO KnowledgeEmbeddingProfile(id,endpointId,model,dimensions,status) VALUES ('relevance','embed-mock','embed',3,'ACTIVE')").run();
  for (const { id } of knowledge.prepare("SELECT id FROM KnowledgeChunk").all() as Array<{ id: string }>) {
    knowledge.prepare("INSERT INTO KnowledgeChunkEmbedding(chunkId,profileId,embedding) VALUES (?,'relevance',?)")
      .run(id, vectorBuffer(["current-0", "current-1"].includes(id) ? [1, 0, 0] : [0, 1, 0]));
  }
  const inputs: string[][] = [];
  let answerCalls = 0;
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    if (body.input) {
      inputs.push(body.input);
      return Response.json({ data: body.input.map((text: string, index: number) => ({ index, embedding: text === "market ceilings" ? [1, 0, 0] : [0, 0, 1] })) });
    }
    answerCalls++; return reply("说明");
  };
  try {
    for (const [question, expected] of [["当前课程内容主要讲的是什么？", 0], ["怎么做西红柿炒鸡蛋？", 0], ["market ceilings", 2]] as const) {
      const item = await conversation();
      const response = await messagesPost(request("quick", undefined, question), { params: Promise.resolve({ id: item.id }) });
      const done = events(await response.text()).find((event) => event.type === "done");
      assert.equal(done.assistantMessage.knowledge.sources.length, expected, question);
      if (!expected) assert.equal(done.assistantMessage.knowledge.warning, "no_relevant_evidence");
    }
    assert.equal(answerCalls, 3);
    assert.equal(inputs.length, 2, "a generic unbound question must not request an embedding");
    assert.ok(inputs.every((batch) => batch.every((text) => !text.includes("支撑"))), "image OCR must not contaminate the embedding query");
    const retrieve = (await import("@/lib/knowledge-deep-search")).retrieveDeepKnowledgeCandidates;
    const unrelated = await retrieve({ queries: ["当前课程内容主要讲的是什么？", "怎么做西红柿炒鸡蛋？"], currentIds: [], targets: [], signal: new AbortController().signal });
    assert.equal(unrelated.semanticSearchUsed, true);
    assert.deepEqual(unrelated.candidates, []);
    const relevant = await retrieve({ queries: ["请翻译当前图片", "market ceilings"], currentIds: [], targets: [], signal: new AbortController().signal });
    assert.equal(relevant.candidates.length, 2);
    assert.ok(relevant.candidates.every((candidate) => candidate.queryIndexes.length === 1 && candidate.queryIndexes[0] === 1));
  } finally {
    await prisma.chartImage.update({ where: { id: "image" }, data: previous });
    knowledge.prepare("UPDATE KnowledgeEmbeddingProfile SET status = 'INACTIVE' WHERE id = 'relevance'").run();
    config.embeddingEndpoints = []; config.activeEmbeddingEndpointId = null; await saveConfig();
  }
});

test("saved skill budgets round trip and stay fixed through a deep question", async () => {
  Object.assign(config.skills.readingCompanion, { deepInputTokenBudget: 24_000, deepTotalInputTokenBudget: 120_000, deepMaxOutputTokens: 777 });
  await saveConfig();
  const readback = await (await settingsGet()).json();
  assert.equal(readback.config.skills.readingCompanion.deepMaxOutputTokens, 777);
  const invalid = { ...config, skills: { ...config.skills, readingCompanion: { ...config.skills.readingCompanion, deepTotalInputTokenBudget: 10 } } };
  assert.equal((await settingsPut(new Request("http://atlas.test/settings", { method: "PUT", body: JSON.stringify(invalid) }))).status, 400);
  const item = await conversation();
  let finalOutputLimit = 0;
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    if (body.stream) { finalOutputLimit = body.max_tokens; return reply("事实 [K1]；未知 [K99]"); }
    if (body.messages[0].content.includes("按问题相关性排序")) return reply(JSON.stringify({ ids: ["current-0"] }));
    // A concurrent settings save must only affect the next question.
    const changed = structuredClone(config); changed.skills.readingCompanion.deepMaxOutputTokens = 333;
    await prisma.appSetting.update({ where: { key: AI_CONFIG_SETTING_KEY }, data: { value: JSON.stringify(changed) } });
    return reply(JSON.stringify({ intent: "comparison", queries: ["支撑与阻力"], targets: [{ documentId: "current", headingPath: [] }, { documentId: "related", headingPath: [] }] }));
  };
  const response = await messagesPost(request("deep"), { params: Promise.resolve({ id: item.id }) });
  const streamed = events(await response.text());
  const done = streamed.find((event) => event.type === "done");
  assert.ok(done, JSON.stringify(streamed));
  assert.deepEqual([...new Set(streamed.filter((event) => event.type === "progress").map((event) => event.phase))], ["planning", "retrieving", "ranking", "reading", "synthesizing"]);
  assert.equal(done.assistantMessage.knowledge.research.budget.deepMaxOutputTokens, 777);
  assert.equal(finalOutputLimit, 777);
  assert.ok(done.assistantMessage.content.includes("未验证引用"));
  assert.equal(currentHeavyTask(), null);
  const saved = await prisma.aiReadingMessage.findUniqueOrThrow({ where: { id: done.assistantMessage.id }, include: { chartImage: { select: { id: true, title: true, originalName: true } } } });
  const originalEvidence = done.assistantMessage.knowledge.sources[0].text;
  knowledge.prepare("UPDATE KnowledgeChunk SET cleanedText = 'new version' WHERE id = ?").run(done.assistantMessage.knowledge.sources[0].id);
  const serialized = (await import("@/lib/ai-reading-companion")).serializeReadingMessage(saved);
  assert.equal(serialized.knowledge?.sources[0].text, originalEvidence);
  knowledge.prepare("DELETE FROM KnowledgeDocument WHERE id = ?").run(done.assistantMessage.knowledge.sources[0].documentId);
  assert.equal((await import("@/lib/ai-reading-companion")).serializeReadingMessage(saved).knowledge?.sources[0].text, originalEvidence);
  await saveConfig();
});

test("request abort and response cancellation stop the upstream and release the lease without saving a draft", async () => {
  for (const disconnect of [false, true]) {
    const item = await conversation();
    let notifyStarted!: () => void;
    const started = new Promise<void>((resolve) => { notifyStarted = resolve; });
    let aborted = false;
    globalThis.fetch = async (_url, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => { aborted = true; reject(new DOMException("cancelled", "AbortError")); }, { once: true });
      notifyStarted();
    });
    const caller = new AbortController();
    const response = await messagesPost(request("deep", caller.signal), { params: Promise.resolve({ id: item.id }) });
    await started;
    assert.equal(currentHeavyTask()?.kind, "ai-deep-reading");
    if (disconnect) await response.body!.cancel();
    else { caller.abort(); await response.text(); }
    for (let i = 0; currentHeavyTask() && i < 100; i++) await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(aborted, true);
    assert.equal(currentHeavyTask(), null);
    assert.equal(await prisma.aiReadingMessage.count({ where: { conversationId: item.id, role: "ASSISTANT" } }), 0);
    assert.equal(acquireHeavyTask("ocr-batch", "probe"), true); releaseHeavyTask("ocr-batch", "probe");
  }
});

test("a disconnected answer stream fails without persisting its partial text", async () => {
  const item = await conversation();
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    if (body.stream) return new Response('data: {"choices":[{"delta":{"content":"unfinished"}}]}\n\n', { headers: { "Content-Type": "text/event-stream" } });
    if (body.messages[0].content.includes("按问题相关性排序")) return reply(JSON.stringify({ ids: ["current-0"] }));
    return reply(JSON.stringify({ intent: "local", queries: ["支撑与阻力"], targets: [] }));
  };
  const response = await messagesPost(request("deep"), { params: Promise.resolve({ id: item.id }) });
  const streamed = events(await response.text());
  assert.ok(streamed.some((event) => event.type === "error"));
  assert.equal(streamed.some((event) => event.type === "done"), false);
  assert.equal(await prisma.aiReadingMessage.count({ where: { conversationId: item.id, role: "ASSISTANT" } }), 0);
  assert.equal(currentHeavyTask(), null);
});
