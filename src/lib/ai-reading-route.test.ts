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
let ocrRefinePost: typeof import("@/app/api/ai/ocr-refine/route").POST;
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
  await prisma.indexNode.create({ data: { id: "switch-node", name: "Flash cards", path: "Flash cards / Charts" } });
  await sharp({ create: { width: 32, height: 32, channels: 3, background: "red" } }).png().toFile(path.join(directory, "cross-chart.png"));
  await sharp({ create: { width: 32, height: 32, channels: 3, background: "blue" } }).png().toFile(path.join(directory, "cross-next.png"));
  await prisma.chartImage.create({ data: { id: "cross-image", originalName: "price-time.png", title: "Charts: Price vs. Time", libraryPath: path.relative(process.cwd(), path.join(directory, "cross-chart.png")), hash: "d".repeat(64), mimeType: "image/png", sizeBytes: 100, indexNodeId: "switch-node", ocrText: "CURRENT_PRICE_VS_TIME" } });
  await prisma.chartImage.create({ data: { id: "cross-next", originalName: "ownership.png", title: "Market ownership", libraryPath: path.relative(process.cwd(), path.join(directory, "cross-next.png")), hash: "e".repeat(64), mimeType: "image/png", sizeBytes: 100, indexNodeId: "switch-node", ocrText: "CURRENT_MARKET_OWNERSHIP" } });
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
  ocrRefinePost = (await import("@/app/api/ai/ocr-refine/route")).POST;
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
  await unlink(path.join(directory, "cross-chart.png"));
  await unlink(path.join(directory, "cross-next.png"));
  await unlink(path.join(directory, "main.db"));
});

async function saveConfig() {
  const response = await settingsPut(new Request("http://atlas.test/api/settings/ai", { method: "PUT", body: JSON.stringify(config) }));
  assert.equal(response.status, 200);
  return response.json();
}
async function conversation() { return prisma.aiReadingConversation.create({ data: {} }); }
function request(mode?: "quick" | "deep", signal?: AbortSignal, content = "解释支撑与阻力", imageId = "image") {
  return new Request("http://atlas.test/messages", { method: "POST", signal, body: JSON.stringify({ imageId, content, ...(mode ? { answerMode: mode } : {}) }) });
}
function reply(text: string) { return Response.json({ choices: [{ message: { content: text } }] }); }
function events(text: string) { return text.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line)); }

test("OCR refinement uses the active MiMo model when an old DeepSeek override remains", async () => {
  const switched = defaultStoredAiConfig();
  switched.endpoints = [
    { ...config.endpoints[0], id: "deepseek", name: "DeepSeek", defaultModel: "deepseek-flash", models: ["deepseek-flash"] },
    { ...config.endpoints[0], id: "mimo", name: "MiMo", provider: "custom", baseUrl: "https://api.xiaomimimo.com/v1", defaultModel: "mimo-v2.6-flash", models: ["mimo-v2.6-flash", "mimo-v2.6-pro"] },
  ];
  switched.activeEndpointId = "mimo";
  switched.skills.ocrRefinement.modelOverride = "deepseek-flash";
  const previousFetch = globalThis.fetch;
  const before = await prisma.chartImage.findUniqueOrThrow({ where: { id: "image" } });
  let calls = 0;
  try {
    const saved = await settingsPut(new Request("http://atlas.test/settings", { method: "PUT", body: JSON.stringify(switched) }));
    assert.equal(saved.status, 200);
    globalThis.fetch = async (url, init) => {
      calls++;
      assert.equal(String(url), "https://api.xiaomimimo.com/v1/chat/completions");
      const body = JSON.parse(String(init?.body));
      assert.equal(body.model, "mimo-v2.6-flash");
      assert.ok(body.messages[1].content.some((part: { type: string }) => part.type === "image_url"));
      assert.match(body.messages[1].content[0].text, /OCR draft/);
      return reply("Corrected OCR");
    };
    const response = await ocrRefinePost(new Request("http://atlas.test/ocr-refine", { method: "POST", body: JSON.stringify({ imageId: "image", ocrText: "OCR draft" }) }));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { refinedText: "Corrected OCR" });
    assert.equal(calls, 1);
    assert.equal((await prisma.chartImage.findUniqueOrThrow({ where: { id: "image" } })).ocrText, before.ocrText);
    const stored = JSON.parse((await prisma.appSetting.findUniqueOrThrow({ where: { key: AI_CONFIG_SETTING_KEY } })).value);
    assert.equal(stored.skills.ocrRefinement.modelOverride, "deepseek-flash");
  } finally { globalThis.fetch = previousFetch; await saveConfig(); }
});

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

test("quick and deep keep one conversation while sending the actual current pixels across and within index nodes", async () => {
  const prepareImage = (await import("@/lib/ai-ocr-refinement")).prepareAiReferenceImage;
  const expectedImages = new Map<string, string>();
  for (const [id, name] of [["image", "chart.png"], ["cross-image", "cross-chart.png"], ["cross-next", "cross-next.png"]]) {
    expectedImages.set(id, `data:image/jpeg;base64,${(await prepareImage(await readFile(path.join(directory, name)))).toString("base64")}`);
  }
  const previous = await prisma.chartImage.findUniqueOrThrow({ where: { id: "image" }, select: { ocrText: true } });
  await prisma.chartImage.update({ where: { id: "image" }, data: { ocrText: "OLD_STOP_OCR" } });
  try {
    for (const mode of ["quick", "deep"] as const) {
      const item = await conversation();
      let currentId = "image";
      let answerCalls = 0;
      globalThis.fetch = async (_url, init) => {
        const body = JSON.parse(String(init?.body));
        if (!body.stream) return reply(JSON.stringify({ intent: "local", queries: ["translate"], targets: [] }));
        answerCalls++;
        const urls = body.messages.flatMap((message: { content: unknown }) => Array.isArray(message.content)
          ? message.content.filter((part: { type: string }) => part.type === "image_url").map((part: { image_url: { url: string } }) => part.image_url.url) : []);
        assert.deepEqual(urls, [expectedImages.get(currentId)], `${mode}: ${currentId}`);
        const latest = JSON.stringify(body.messages.at(-1).content);
        assert.match(latest, /当前参考图/);
        assert.ok(latest.includes(currentId));
        if (currentId === "cross-image") {
          assert.match(latest, /CURRENT_PRICE_VS_TIME/);
          assert.doesNotMatch(JSON.stringify(body.messages), /OLD_STOP_OCR/);
          assert.ok(body.messages.some((message: { role: string; content: unknown }) => message.role === "assistant" && message.content === "回答 image"));
        } else if (currentId === "cross-next") {
          assert.match(latest, /CURRENT_MARKET_OWNERSHIP/);
          assert.doesNotMatch(JSON.stringify(body.messages), /CURRENT_PRICE_VS_TIME|OLD_STOP_OCR/);
        }
        return reply(`回答 ${currentId}`);
      };
      for (const imageId of expectedImages.keys()) {
        currentId = imageId;
        const response = await messagesPost(request(mode, undefined, "翻译这一页", imageId), { params: Promise.resolve({ id: item.id }) });
        const streamed = events(await response.text());
        assert.equal(streamed.find((event) => event.type === "start").userMessage.image.id, imageId);
        assert.equal(streamed.find((event) => event.type === "done")?.assistantMessage.content, `回答 ${imageId}`, JSON.stringify(streamed));
      }
      assert.equal(answerCalls, 3);
      const saved = await prisma.aiReadingMessage.findMany({ where: { conversationId: item.id, role: "USER" }, orderBy: { sequence: "asc" } });
      assert.deepEqual(saved.map((message) => message.chartImageId), [...expectedImages.keys()]);
      assert.equal(await prisma.aiReadingMessage.count({ where: { conversationId: item.id } }), 6);
    }
  } finally { await prisma.chartImage.update({ where: { id: "image" }, data: previous }); }
});

test("explicit cross-topic comparisons retain both actual image files and distinguish current from history", async () => {
  const prepareImage = (await import("@/lib/ai-ocr-refinement")).prepareAiReferenceImage;
  const previousUrl = `data:image/jpeg;base64,${(await prepareImage(await readFile(path.join(directory, "chart.png")))).toString("base64")}`;
  const currentUrl = `data:image/jpeg;base64,${(await prepareImage(await readFile(path.join(directory, "cross-chart.png")))).toString("base64")}`;
  const item = await conversation();
  let calls = 0;
  globalThis.fetch = async (_url, init) => {
    calls++;
    const body = JSON.parse(String(init?.body));
    const visualMessages = body.messages.filter((message: { content: unknown }) => Array.isArray(message.content));
    if (calls === 1) {
      assert.deepEqual(visualMessages[0].content[1].image_url.url, previousUrl);
    } else {
      assert.equal(visualMessages.length, 2);
      assert.equal(visualMessages[0].content[1].image_url.url, previousUrl);
      assert.equal(visualMessages[1].content[1].image_url.url, currentUrl);
      assert.match(visualMessages[0].content[0].text, /历史参考图/);
      assert.match(visualMessages[0].content[0].text, /"ocr"/);
      assert.match(visualMessages[1].content[0].text, /当前参考图/);
      assert.match(visualMessages[1].content[0].text, /CURRENT_PRICE_VS_TIME/);
    }
    return reply("比较结果");
  };
  for (const [imageId, question] of [["image", "解释当前图片"], ["cross-image", "比较当前图片和上一张图"]]) {
    const response = await messagesPost(request("quick", undefined, question, imageId), { params: Promise.resolve({ id: item.id }) });
    assert.ok(events(await response.text()).some((event) => event.type === "done"));
  }
  assert.equal(calls, 2);
  assert.equal(await prisma.aiReadingMessage.count({ where: { conversationId: item.id } }), 4);
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


test("reading windows share a send lease and clearing history blocks a late reply", async () => {
  const item = await conversation();
  let resolve!: (value: Response) => void, entered!: () => void;
  const started = new Promise<void>((done) => { entered = done; });
  globalThis.fetch = async () => { entered(); return new Promise<Response>((done) => { resolve = done; }); };
  const response = await messagesPost(request("quick"), { params: Promise.resolve({ id: item.id }) }); await started;
  const peer = await messagesPost(request("quick"), { params: Promise.resolve({ id: item.id }) }); assert.equal(peer.status, 409);
  const clear = (await import("@/app/api/ai/reading-companion/conversations/[id]/messages/route")).DELETE;
  assert.equal((await clear(new Request("http://atlas.test"), { params: Promise.resolve({ id: item.id }) })).status, 200);
  resolve(reply("late response")); await response.text();
  assert.equal(await prisma.aiReadingMessage.count({ where: { conversationId: item.id } }), 0);
  globalThis.fetch = async () => reply("next response");
  const next = await messagesPost(request("quick"), { params: Promise.resolve({ id: item.id }) }); assert.ok(events(await next.text()).some((event) => event.type === "done"));
});
