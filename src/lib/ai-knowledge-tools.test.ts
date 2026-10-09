import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { mkdtemp, readFile, readdir, unlink } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import Database from "better-sqlite3";
import { load as loadSqliteVec } from "sqlite-vec";
import { toolTestConfig, turnResponse } from "@/lib/ai-tool-test-helpers";
import { vectorBuffer } from "@/lib/knowledge-db";
import { validateRobotKnowledgeCitations, parseRobotKnowledge } from "@/lib/robot-knowledge-types";
import type { AiToolExecutionContext } from "@/lib/ai-tool-registry";
import type { RobotKnowledgeSource } from "@/lib/robot-knowledge-types";
import type { PrismaClient } from "@/generated/prisma/client";
let prisma: PrismaClient, knowledge: InstanceType<typeof Database>, directory: string;
let createSession: typeof import("@/lib/ai-knowledge-tools").createKnowledgeToolSession;
let run: typeof import("@/lib/ai-tool-runtime").runAiToolTask;
let messages: typeof import("@/app/api/ai/robot/conversations/[id]/messages/route");
let conversations: typeof import("@/app/api/ai/robot/conversations/route");
let conversation: typeof import("@/app/api/ai/robot/conversations/[id]/route");
const oldUrl = process.env.DATABASE_URL, oldFetch = globalThis.fetch;
const config = toolTestConfig();
config.embeddingEndpoints = [{ id: "embed", name: "Embed", provider: "custom", baseUrl: "https://embedding.test/v1", apiKey: "secret-embedding-key", useCustomUrls: false, embeddingsUrl: "", modelsUrl: "", models: [], embeddingModel: "test-embedding" }];
config.activeEmbeddingEndpointId = "embed";
const context = (indexNodeId: string | null = "child"): AiToolExecutionContext => ({ runId: "run", signal: new AbortController().signal, scope: { kind: "library" }, currentIndexNodeId: indexNodeId, currentImageId: null });
type Search = { sources: RobotKnowledgeSource[]; totalCandidates: number; nextOffset: number | null; semanticSearchUsed: boolean; warnings: string[] };
type Read = { sources: RobotKnowledgeSource[]; nextCursor: string | null };
async function invoke<T>(session: ReturnType<typeof createSession>, name: string, args: unknown, ctx = context()): Promise<T> {
  const tool = session.registry.get(name)!;
  return await tool.execute(tool.validate(args), ctx) as T;
}
function doc(id: string, node: string | null, enabled = 1, inherit = 0) {
  knowledge.prepare("INSERT INTO KnowledgeDocument(id,title,lessonCode,normalizedLessonCode,sourceType,enabled) VALUES(?,?,?,?, 'BOOK',?)").run(id, id, id, id, enabled);
  knowledge.prepare("INSERT INTO KnowledgeDocumentBinding(id,documentId,indexNodeId,indexPathSnapshot,appliesToDescendants) VALUES(?,?,?,?,?)").run(id, id, node, node ?? "", inherit);
  knowledge.prepare(`INSERT INTO KnowledgeDocumentVersion(id,documentId,versionNumber,sourceFileName,sourceMimeType,sourceSizeBytes,sourceHash,sourcePath,rawText,status,sourceFormat)
    VALUES(?,?,1,'fixture.md','text/plain',1,?,'secret-source-path','raw','ACTIVE','MARKDOWN')`).run(`v-${id}`, id, id.padEnd(64, "a"));
}
function chunk(id: string, document: string, ordinal: number, text: string, heading = "第一章") {
  knowledge.prepare(`INSERT INTO KnowledgeChunk(id,versionId,ordinal,sourceCueStart,sourceCueEnd,originalText,cleanedText,topic,keywordsJson,locatorJson)
    VALUES(?,?,?,1,1,?,?,'支撑','["支撑","H2"]',?)`).run(id, `v-${document}`, ordinal, text, text, JSON.stringify({ v: 1, kind: "text", lineStart: ordinal + 1, lineEnd: ordinal + 1, headingPath: [heading] }));
  knowledge.prepare("INSERT INTO KnowledgeChunkFts(chunkId,documentId,versionId,title,lessonCode,topic,keywords,cleanedText) VALUES(?,?,?,?,?,'支撑','支撑 H2',?)").run(id, document, `v-${document}`, document, document, text);
  for (const word of ["支撑", "H2"]) knowledge.prepare("INSERT INTO KnowledgeChunkKeyword(chunkId,keyword,normalizedKeyword) VALUES(?,?,?)").run(id, word, word.toLowerCase());
}
before(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "atlas-knowledge-tools-")); process.env.DATABASE_URL = `file:${path.join(directory, "main.db")}`;
  const main = new Database(path.join(directory, "main.db"));
  for (const entry of (await readdir(path.join(process.cwd(), "prisma/migrations"), { withFileTypes: true })).filter((entry) => entry.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) main.exec(await readFile(path.join(process.cwd(), "prisma/migrations", entry.name, "migration.sql"), "utf8"));
  main.close(); knowledge = new Database(":memory:"); loadSqliteVec(knowledge);
  for (const name of ["20260930000000_init", "20261002000000_generalize_knowledge_sources"]) knowledge.exec(await readFile(path.join(process.cwd(), "knowledge/migrations", name, "migration.sql"), "utf8"));
  (globalThis as typeof globalThis & { brooksKnowledgeDb?: typeof knowledge }).brooksKnowledgeDb = knowledge;
  prisma = (await import("@/lib/db")).prisma;
  await prisma.indexNode.create({ data: { id: "grand", name: "Grand", path: "Grand" } });
  await prisma.indexNode.create({ data: { id: "root", name: "Root", path: "Grand/Root", parentId: "grand", depth: 1 } });
  await prisma.indexNode.create({ data: { id: "disabled-node", name: "Disabled", path: "Disabled" } });
  await prisma.indexNode.create({ data: { id: "child", name: "Child", path: "Root/Child", parentId: "root", depth: 1 } });
  await prisma.indexNode.create({ data: { id: "other", name: "Other", path: "Other" } });
  await prisma.chartImage.create({ data: { id: "image", originalName: "fixture.png", libraryPath: "images/fixture.png", hash: "a".repeat(64), sizeBytes: 1, mimeType: "image/png", indexNodeId: "child" } });
  for (const [id, node, enabled, inherit] of [["book", "root", 1, 1], ["lesson", "child", 1, 0], ["parent-only", "grand", 1, 0], ["related", "other", 1, 0], ["disabled", "disabled-node", 0, 0], ["orphan", "gone", 1, 0], ["unbound", null, 1, 0]] as const) { doc(id, node, enabled, inherit); chunk(`${id}-0`, id, 0, `支撑阻力 H2 ${id} 的证据`); }
  chunk("long", "book", 1, "支撑😀".repeat(1700));
  for (let i = 2; i < 132; i++) chunk(`book-${i}`, "book", i, `支撑第${i}段`, i < 127 ? "第一章" : "第二章");
  createSession = (await import("@/lib/ai-knowledge-tools")).createKnowledgeToolSession;
  run = (await import("@/lib/ai-tool-runtime")).runAiToolTask;
  messages = await import("@/app/api/ai/robot/conversations/[id]/messages/route");
  conversations = await import("@/app/api/ai/robot/conversations/route"); conversation = await import("@/app/api/ai/robot/conversations/[id]/route");
  await (await import("@/lib/ai-settings")).saveAiConfig((await import("@/lib/ai-config")).aiConfigInputSchema.parse(config));
});
after(async () => {
  globalThis.fetch = oldFetch; await prisma?.$disconnect(); knowledge?.close();
  delete (globalThis as typeof globalThis & { brooksKnowledgeDb?: typeof knowledge }).brooksKnowledgeDb;
  if (oldUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = oldUrl;
  await unlink(path.join(directory, "main.db"));
});

test("catalog, current inheritance, explicit documents and selection authorization exclude invalid bindings", async () => {
  const session = createSession({ config });
  const listed = await invoke<{ documents: { id: string }[]; total: number }>(session, "list_knowledge_documents", { scope: "current" });
  assert.deepEqual(listed.documents.map((doc) => doc.id).sort(), ["book", "lesson"]);
  const empty = await invoke<{ documents: unknown[] }>(session, "list_knowledge_documents", { scope: "current" }, context(null)); assert.equal(empty.documents.length, 0);
  const imageContext = { ...context(null), currentImageId: "image" };
  assert.equal((await invoke<{ total: number }>(session, "list_knowledge_documents", { scope: "current" }, imageContext)).total, 2);
  assert.equal((await invoke<{ total: number }>(session, "list_knowledge_documents", {})).total, 4);
  const restricted = { ...context(), scope: { kind: "selection" as const, imageIds: ["image"], indexNodeIds: [] } };
  const found = await invoke<Search>(session, "search_knowledge", { query: "支撑", limit: 10 }, restricted);
  assert.ok(found.sources.every((source) => ["book", "lesson"].includes(source.documentId)));
  await assert.rejects(invoke(session, "search_knowledge", { query: "支撑", scope: "documents", documentIds: ["related"] }, restricted), /outside/);
  await assert.rejects(invoke(session, "search_knowledge", { query: "支撑", scope: "documents" }), /requires/);
  assert.equal(session.snapshot(), null);
});

test("hybrid recall prioritizes current materials, narrows before quotas, and labels candidate coverage", async () => {
  const session = createSession({ config });
  const first = await invoke<Search>(session, "search_knowledge", { query: "支撑", limit: 1 });
  assert.equal(first.sources[0].documentId, "book"); assert.equal(first.nextOffset, 1); assert.ok(first.totalCandidates <= 100);
  const narrowed = await invoke<Search>(session, "search_knowledge", { query: "支撑", scope: "documents", documentIds: ["related"] });
  assert.equal(narrowed.sources.length, 1); assert.equal(narrowed.sources[0].documentId, "related");
  const terms = await invoke<Search>(session, "search_knowledge", { query: "H2", scope: "current" }); assert.ok(terms.sources.length);
  const generic = await invoke<Search>(session, "search_knowledge", { query: "请解释当前图片" }); assert.equal(generic.totalCandidates, 0);
  const missing = await invoke<Search>(session, "search_knowledge", { query: "火星种植土豆" }); assert.equal(missing.totalCandidates, 0);
  const next = await invoke<Search>(session, "search_knowledge", { query: "支撑", offset: 1, limit: 1 }); assert.notEqual(first.sources[0].id, next.sources[0].id);
  const repeated = await invoke<Search>(session, "search_knowledge", { query: "支撑", limit: 1 }); assert.deepEqual(first, repeated);
  assert.ok(first.warnings.includes("semantic_unavailable"));
  assert.doesNotMatch(JSON.stringify(first), /secret-source-path|secret-embedding-key/);
});

test("Unicode chunk and chapter reads paginate without loading whole documents and reject stale cursors", async () => {
  const session = createSession({ config });
  const target = { kind: "chunk", chunkId: "long", versionId: "v-book" };
  let cursor: string | undefined; const parts: RobotKnowledgeSource[] = [];
  do {
    const page = await invoke<Read>(session, "read_knowledge", { target, limitChars: 2000, ...(cursor ? { cursor } : {}) });
    assert.ok(Buffer.byteLength(JSON.stringify({ ok: true, data: page })) <= 32768);
    parts.push(...page.sources); cursor = page.nextCursor ?? undefined;
  } while (cursor);
  assert.equal(parts.map((part) => part.text).join(""), "支撑😀".repeat(1700));
  assert.equal(parts[1].page.offset, 2000); assert.equal(parts[0].page.total, 5100); assert.ok(parts.every((part) => part.page.partial));
  const chapter = { kind: "document", documentId: "book", versionId: "v-book", headingPath: ["第二章"] };
  const page = await invoke<Read>(session, "read_knowledge", { target: chapter });
  assert.equal(page.sources.length, 5); assert.equal(page.nextCursor, null);
  assert.ok(page.sources.every((source) => source.locator.kind === "text" && source.locator.headingPath[0] === "第二章"));
  const partial = await invoke<Read>(session, "read_knowledge", { target, limitChars: 2 });
  await assert.rejects(invoke(session, "read_knowledge", { target: chapter, cursor: partial.nextCursor }), /Invalid/);
  knowledge.prepare("UPDATE KnowledgeDocumentVersion SET status='ARCHIVED' WHERE id='v-book'").run();
  try { await assert.rejects(invoke(session, "read_knowledge", { target, cursor: partial.nextCursor }), /changed/); }
  finally { knowledge.prepare("UPDATE KnowledgeDocumentVersion SET status='ACTIVE' WHERE id='v-book'").run(); }
});

test("semantic search reuses a frozen config/cache, accounts before requests and degrades without rebuilding", async () => {
  knowledge.prepare("INSERT INTO KnowledgeEmbeddingProfile(id,endpointId,model,dimensions,status) VALUES('profile','embed','test-embedding',3,'ACTIVE')").run();
  knowledge.prepare("INSERT INTO KnowledgeChunkEmbedding(chunkId,profileId,embedding) VALUES('related-0','profile',?)").run(vectorBuffer([1, 0, 0]));
  let calls = 0, reserved = 0;
  const mutable = structuredClone(config), session = createSession({ config: mutable, beforeEmbeddingRequest: () => { reserved++; } });
  mutable.embeddingEndpoints[0].baseUrl = "https://changed.invalid";
  globalThis.fetch = async (url) => { calls++; assert.equal(reserved, calls); assert.match(String(url), /embedding.test/); return Response.json({ data: [{ index: 0, embedding: [1, 0, 0] }] }); };
  try {
    const first = await invoke<Search>(session, "search_knowledge", { query: "支撑", limit: 1 }); session.accept("search_knowledge", first);
    await invoke(session, "search_knowledge", { query: "支撑", offset: 1, limit: 1 });
    assert.equal(calls, 1); assert.equal(first.semanticSearchUsed, true); assert.equal(session.snapshot()?.retrieval.embeddingRequests, 1);
    globalThis.fetch = async () => { throw new Error("unavailable"); };
    const failed = await invoke<Search>(createSession({ config }), "search_knowledge", { query: "支撑" }); assert.equal(failed.semanticSearchUsed, false); assert.ok(failed.sources.length);
    let fetched = false; globalThis.fetch = async () => { fetched = true; throw new Error("Unexpected request"); };
    await assert.rejects(invoke(createSession({ config, beforeEmbeddingRequest: () => { throw new Error("storage reservation failed"); } }), "search_knowledge", { query: "支撑" }), /reservation failed/);
    assert.equal(fetched, false);
    const controller = new AbortController(); controller.abort();
    await assert.rejects(invoke(session, "search_knowledge", { query: "H2" }, { ...context(), signal: controller.signal }));
    assert.equal((knowledge.prepare("SELECT COUNT(*) AS count FROM KnowledgeChunkEmbedding").get() as { count: number }).count, 1);
  } finally { knowledge.prepare("DELETE FROM KnowledgeChunkEmbedding WHERE profileId='profile'").run(); knowledge.prepare("DELETE FROM KnowledgeEmbeddingProfile WHERE id='profile'").run(); globalThis.fetch = oldFetch; }
});

test("executor accepts bounded evidence only and snapshots deduplicate actual pages and citations", async () => {
  const session = createSession({ config }); let calls = 0;
  const result = await run({ registry: session.registry, allowedTools: ["search_knowledge"], config, context: { scope: { kind: "library" }, currentImageId: null, currentIndexNodeId: "child" }, messages: [{ role: "user", content: "支撑" }], onToolSucceeded: session.accept,
    fetchImpl: async () => ++calls <= 2 ? turnResponse(null, [{ id: `call-${calls}`, name: "search_knowledge", arguments: '{"query":"支撑","limit":1}' }]) : turnResponse("解释 [K1] [K999]") });
  assert.equal(result.status, "completed"); assert.equal(session.snapshot()?.sources.length, 1);
  const evidence = session.snapshot()!; assert.equal(validateRobotKnowledgeCitations(result.answer!, evidence.sources, "zh"), "解释 [K1] [未验证引用]");
  assert.doesNotMatch(JSON.stringify(result.records), /支撑|fixture.md|secret-embedding-key/);
  assert.equal(parseRobotKnowledge(JSON.stringify(evidence))?.sources[0].text, evidence.sources[0].text); assert.equal(parseRobotKnowledge("broken"), null);
  const rejected = createSession({ config }); calls = 0;
  const oversized = await run({ registry: rejected.registry, allowedTools: ["search_knowledge"], config, context: { scope: { kind: "library" }, currentImageId: null, currentIndexNodeId: "child" }, messages: [{ role: "user", content: "支撑" }], limits: { maxToolResultBytes: 20 }, onToolSucceeded: rejected.accept,
    fetchImpl: async () => ++calls === 1 ? turnResponse(null, [{ id: "oversized", name: "search_knowledge", arguments: '{"query":"支撑","limit":1}' }]) : turnResponse("没有证据") });
  assert.equal(oversized.successfulToolCalls, 0); assert.equal(rejected.snapshot(), null);
});

test("normal robot persists reference snapshots separately and history survives deleted/updated sources", async () => {
  const conversationId = (await (await conversations.POST()).json()).conversation.id as string;
  let calls = 0, cited = "";
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    if (++calls === 1) return turnResponse(null, [{ id: "knowledge", name: "search_knowledge", arguments: '{"query":"支撑","scope":"documents","documentIds":["related"]}' }]);
    const output = JSON.parse(body.messages.find((message: { role: string }) => message.role === "tool").content).data;
    cited = output.sources[0].citation; return turnResponse(`课程观点 [${cited}] [K999]`);
  };
  const request = new Request("http://local", { method: "POST", body: JSON.stringify({ content: "查支撑", locale: "zh", imageId: "image" }) });
  const response = await messages.POST(request, { params: Promise.resolve({ id: conversationId }) });
  const events = (await response.text()).trim().split("\n").map((line) => JSON.parse(line));
  const done = events.find((event) => event.type === "done"); assert.ok(done, JSON.stringify(events));
  assert.match(done.message.content, /未验证引用/); assert.equal(done.message.knowledge.sources[0].documentId, "related");
  const saved = await prisma.aiRobotMessage.findFirstOrThrow({ where: { conversationId, role: "ASSISTANT" } });
  assert.ok(saved.knowledgeContextJson?.includes("related 的证据")); assert.ok(!saved.executionJson?.includes("related 的证据"));
  const deleted = knowledge.prepare("SELECT * FROM KnowledgeChunk WHERE id='related-0'").get() as Record<string, unknown>;
  const keywords = knowledge.prepare("SELECT * FROM KnowledgeChunkKeyword WHERE chunkId='related-0'").all() as { chunkId: string; keyword: string; normalizedKeyword: string }[];
  knowledge.prepare("UPDATE KnowledgeDocument SET enabled=0,title='Changed' WHERE id='related'").run();
  knowledge.prepare("DELETE FROM KnowledgeChunk WHERE id='related-0'").run();
  try {
    const history = await (await conversation.GET(new Request("http://local"), { params: Promise.resolve({ id: conversationId }) })).json();
    assert.equal(history.messages.at(-1).knowledge.sources[0].title, "related");
    assert.ok(history.messages.at(-1).knowledge.sources[0].text.includes("related 的证据"));
    globalThis.fetch = async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      assert.ok(body.messages.some((message: { content: string }) => message.content.includes("Historical citation identities")));
      assert.ok(!JSON.stringify(body.messages).includes("related 的证据")); return turnResponse("需要重新读取当前有效版本");
    };
    const follow = await messages.POST(new Request("http://local", { method: "POST", body: JSON.stringify({ content: "继续解释", locale: "zh" }) }), { params: Promise.resolve({ id: conversationId }) }); await follow.text();
  } finally {
    knowledge.prepare(`INSERT INTO KnowledgeChunk (${Object.keys(deleted).join(",")}) VALUES (${Object.keys(deleted).map(() => "?").join(",")})`).run(...Object.values(deleted));
    for (const keyword of keywords) knowledge.prepare("INSERT OR IGNORE INTO KnowledgeChunkKeyword(chunkId,keyword,normalizedKeyword) VALUES(?,?,?)").run(keyword.chunkId, keyword.keyword, keyword.normalizedKeyword);
    knowledge.prepare("UPDATE KnowledgeDocument SET enabled=1,title='related' WHERE id='related'").run(); globalThis.fetch = oldFetch;
  }
});

test("cancelling after a successful knowledge read never saves a late answer or evidence snapshot", async () => {
  const conversationId = (await (await conversations.POST()).json()).conversation.id as string;
  let calls = 0, release!: (response: Response) => void, started!: () => void;
  const pending = new Promise<void>((resolve) => { started = resolve; });
  const controller = new AbortController();
  globalThis.fetch = async () => {
    if (++calls === 1) return turnResponse(null, [{ id: "read", name: "search_knowledge", arguments: '{"query":"H2","limit":1}' }]);
    started(); return new Promise<Response>((resolve) => { release = resolve; });
  };
  try {
    const response = await messages.POST(new Request("http://local", { method: "POST", signal: controller.signal, body: JSON.stringify({ content: "H2", locale: "en" }) }), { params: Promise.resolve({ id: conversationId }) });
    await pending; controller.abort(); release(turnResponse("Late answer [K1]"));
    assert.ok(!(await response.text()).includes('"type":"done"'));
    assert.equal(await prisma.aiRobotMessage.count({ where: { conversationId, role: "ASSISTANT" } }), 0);
  } finally { globalThis.fetch = oldFetch; }
});

test("a database missing the new citation column returns an upgrade before paid model requests", async () => {
  const conversationId = (await (await conversations.POST()).json()).conversation.id as string;
  let calls = 0; globalThis.fetch = async () => { calls++; return turnResponse("Unexpected"); };
  await prisma.$executeRawUnsafe('ALTER TABLE "AiRobotMessage" DROP COLUMN "knowledgeContextJson"');
  try {
    const response = await messages.POST(new Request("http://local", { method: "POST", body: JSON.stringify({ content: "Hello", locale: "en" }) }), { params: Promise.resolve({ id: conversationId }) });
    assert.equal(response.status, 503); assert.equal((await response.json()).code, "storage_upgrade_required"); assert.equal(calls, 0);
  } finally { await prisma.$executeRawUnsafe('ALTER TABLE "AiRobotMessage" ADD COLUMN "knowledgeContextJson" TEXT'); globalThis.fetch = oldFetch; }
});
