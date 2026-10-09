import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { mkdtemp, readFile, readdir, unlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { load as loadSqliteVec } from "sqlite-vec";
import { aiConfigInputSchema } from "@/lib/ai-config";
import { parseTaskPlan, validateTaskCitations, taskActionSchema } from "@/lib/ai-robot-task-types";
import { toolTestConfig, sseResponse, turnResponse } from "@/lib/ai-tool-test-helpers";
import { acquireHeavyTask, releaseHeavyTask } from "@/lib/background-task-coordinator";
import type { TaskSnapshot } from "@/lib/ai-robot-task-types";
import type { PrismaClient } from "@/generated/prisma/client";
import { vectorBuffer } from "@/lib/knowledge-db";
let prisma: PrismaClient, service: typeof import("@/lib/ai-robot-task-service"), sources: typeof import("@/lib/ai-robot-task-sources");
let collection: typeof import("@/app/api/ai/robot/conversations/route"), actions: typeof import("@/app/api/ai/robot/tasks/[id]/actions/route"), tasksRoute: typeof import("@/app/api/ai/robot/conversations/[id]/tasks/route"), messages: typeof import("@/app/api/ai/robot/conversations/[id]/messages/route");
let saveConfig: typeof import("@/lib/ai-settings").saveAiConfig;
let directory: string, knowledge: InstanceType<typeof Database>;
const originalFetch = globalThis.fetch, previousUrl = process.env.DATABASE_URL, config = toolTestConfig();
const plan = { title: "测试总结", scope: { kind: "current", ids: [] }, steps: ["阅读并分析当前资料", "整理阅读笔记", "综合总结"], approach: "比较共同点与差异并引用证据" };
const context = (id: string) => ({ params: Promise.resolve({ id }) });
function mock() {
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    if (body.stream) return sseResponse([{ choices: [{ delta: { content: JSON.stringify(plan) }, finish_reason: null }] }, { choices: [{ delta: {}, finish_reason: "stop" }] }]);
    return turnResponse(body.messages[0].content.includes("现在所有") ? "最终总结 [T1]" : "这批资料的支撑观点 [T1]");
  };
}
async function conversation() { const response = await collection.POST(new Request("http://local", { method: "POST", body: JSON.stringify({ mode: "task" }) })); return (await response.json()).conversation.id as string; }
async function ready(id: string, terminal = ["awaiting_confirmation", "paused", "completed", "failed"]) {
  for (let index = 0; index < 150; index++) { const task = await service.getRobotTask(id); if (terminal.includes(task.status)) return task; await new Promise((resolve) => setTimeout(resolve, 10)); }
  throw new Error("Task did not settle");
}
const control = (task: TaskSnapshot, action: "start" | "pause" | "resume" | "cancel" | "replan", feedback?: string) => service.controlRobotTask(task.id, { action, revision: task.revision, planVersion: task.planVersion, feedback });
async function create(imageId = "image") { return ready((await service.createRobotTask(await conversation(), { content: "总结资料", locale: "zh", imageId })).id); }
before(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "atlas-robot-task-")); process.env.DATABASE_URL = `file:${path.join(directory, "main.db")}`;
  const db = new Database(path.join(directory, "main.db"));
  for (const entry of (await readdir(path.join(process.cwd(), "prisma/migrations"), { withFileTypes: true })).filter((entry) => entry.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) db.exec(await readFile(path.join(process.cwd(), "prisma/migrations", entry.name, "migration.sql"), "utf8"));
  db.close(); knowledge = new Database(":memory:"); loadSqliteVec(knowledge);
  for (const name of ["20260930000000_init", "20261002000000_generalize_knowledge_sources"]) knowledge.exec(await readFile(path.join(process.cwd(), "knowledge/migrations", name, "migration.sql"), "utf8"));
  (globalThis as typeof globalThis & { brooksKnowledgeDb?: typeof knowledge }).brooksKnowledgeDb = knowledge;
  prisma = (await import("@/lib/db")).prisma;
  service = await import("@/lib/ai-robot-task-service"); sources = await import("@/lib/ai-robot-task-sources");
  collection = await import("@/app/api/ai/robot/conversations/route"); actions = await import("@/app/api/ai/robot/tasks/[id]/actions/route"); tasksRoute = await import("@/app/api/ai/robot/conversations/[id]/tasks/route"); messages = await import("@/app/api/ai/robot/conversations/[id]/messages/route");
  saveConfig = (await import("@/lib/ai-settings")).saveAiConfig;
  await prisma.indexNode.create({ data: { id: "node", name: "测试", path: "测试" } });
  for (const id of ["image", "other", "long"]) await prisma.chartImage.create({ data: { id, originalName: `${id}.png`, libraryPath: `images/${id}.png`, mimeType: "image/png", sizeBytes: 1, hash: id.padEnd(64, "a"), notes: id === "long" ? "价格行为支撑与阻力".repeat(1500) : "价格行为支撑与阻力" } });
  await saveConfig(aiConfigInputSchema.parse(config)); mock();
});
after(async () => {
  for (const row of await prisma.aiRobotTask.findMany({ select: { id: true } })) await service.stopRobotTask(row.id, "cancelled");
  globalThis.fetch = originalFetch; await prisma.$disconnect(); knowledge.close();
  if (previousUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previousUrl;
  await unlink(path.join(directory, "main.db"));
});
test("task schema rejects malformed plans, actions and invented references", () => {
  assert.equal(parseTaskPlan("```json\n" + JSON.stringify(plan) + "\n```").steps.length, 3);
  assert.throws(() => parseTaskPlan(JSON.stringify({ ...plan, steps: [] })));
  assert.equal(taskActionSchema.safeParse({ action: "resume", revision: 1, planVersion: 1, tools: [] }).success, false);
  assert.equal(validateTaskCitations("[T1] [T999]", new Set(["T1"])), "[T1] [未验证引用]");
});
test("ordinary conversations remain the default and task messages use a dedicated endpoint", async () => {
  const ordinary = (await (await collection.POST()).json()).conversation;
  assert.equal(ordinary.mode, "normal"); const taskId = await conversation();
  const normal = await (await collection.GET()).json(); assert.ok(normal.conversations.some((row: { id: string }) => row.id === ordinary.id)); assert.ok(!normal.conversations.some((row: { id: string }) => row.id === taskId));
  const taskList = await (await collection.GET(new Request("http://local?mode=task"))).json(); assert.ok(taskList.conversations.some((row: { id: string }) => row.id === taskId));
  const response = await messages.POST(new Request("http://local", { method: "POST", body: JSON.stringify({ content: "text" }) }), context(taskId)); assert.equal(response.status, 400);
});
test("planning waits for confirmation, executes real scoped reads, persists evidence and final history", async () => {
  mock(); const task = await create(); assert.equal(task.status, "awaiting_confirmation"); assert.equal(task.checkpoints.length, 0); assert.equal(task.budget.modelCalls, 1);
  await control(task, "start"); const done = await ready(task.id, ["completed", "failed", "paused"]); assert.equal(done.status, "completed", done.error ?? ""); assert.equal(done.completedBatches, done.totalBatches); assert.ok(done.checkpoints[0].sources[0].text.includes("支撑")); assert.equal(done.result, "最终总结 [T1]");
  const rows = await prisma.aiRobotMessage.findMany({ where: { conversationId: done.conversationId } }); assert.equal(rows.length, 2); assert.ok(!JSON.stringify(done).includes("private-test-key"));
  const compact = await service.getRobotTask(task.id, false); assert.equal(compact.checkpoints.length, 0); assert.equal(compact.checkpointCount, done.checkpoints.length);
  const manifest = JSON.parse((await prisma.aiRobotTask.findUniqueOrThrow({ where: { id: task.id } })).manifestJson!);
  const registry = sources.createRobotTaskRegistry(manifest), contextValue = { scope: { kind: "library" as const }, runId: "test", signal: new AbortController().signal, currentImageId: null, currentIndexNodeId: null };
  await assert.rejects(registry.get("read_task_source")!.execute({ citation: "T999" }, contextValue), /outside/);
  const images = await registry.get("list_images")!.execute({ query: "", offset: 0, limit: 20 }, contextValue) as { images: { id: string }[] }; assert.deepEqual(images.images.map((row) => row.id), ["image"]);
});
test("stale actions are rejected and a conflicting heavy task leaves the plan restartable", async () => {
  mock(); const task = await create();
  assert.ok(acquireHeavyTask("thumbnails", "busy-test"));
  try { await assert.rejects(control(task, "start"), /后台重任务/); assert.equal((await service.getRobotTask(task.id)).status, "awaiting_confirmation"); }
  finally { releaseHeavyTask("thumbnails", "busy-test"); }
  await control(task, "start");
  const response = await actions.POST(new Request("http://local", { method: "POST", body: JSON.stringify({ action: "start", revision: task.revision, planVersion: task.planVersion }) }), context(task.id)); assert.equal(response.status, 409);
  await ready(task.id, ["completed", "failed", "paused"]);
});
test("pause interrupts the in-flight batch and resume reuses committed checkpoints and cumulative budget", async () => {
  mock(); const task = await create("long"); assert.ok(task.totalBatches > 1);
  let reads = 0, entered!: () => void; const reached = new Promise<void>((resolve) => { entered = resolve; });
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    if (++reads === 2) { entered(); return new Promise<Response>((_resolve, reject) => { init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true }); }); }
    return turnResponse(body.messages[0].content.includes("现在所有") ? "完成 [T1]" : "持久化笔记 [T1]");
  };
  await control(task, "start"); await reached;
  const before = await service.getRobotTask(task.id); assert.equal(before.completedBatches, 1); const saved = await prisma.aiRobotTaskCheckpoint.findFirstOrThrow({ where: { taskId: task.id, ordinal: 0 } });
  const paused = await control(before, "pause"); assert.equal(paused.status, "paused"); assert.equal(paused.completedBatches, 1);
  mock(); await control(paused, "resume"); const done = await ready(task.id, ["completed", "failed", "paused"]); assert.equal(done.status, "completed", done.error ?? ""); assert.ok(done.budget.modelCalls > paused.budget.modelCalls);
  assert.equal((await prisma.aiRobotTaskCheckpoint.findFirstOrThrow({ where: { taskId: task.id, ordinal: 0 } })).id, saved.id);
});
test("source changes pause execution, replanning preserves the previous task evidence", async () => {
  mock(); const task = await create(); await prisma.chartImage.update({ where: { id: "image" }, data: { notes: "changed" } });
  await control(task, "start"); const paused = await ready(task.id, ["paused", "failed"]); assert.equal(paused.status, "paused"); assert.match(paused.error!, /版本/);
  const next = await control(paused, "replan", "只分析更新后的资料"); assert.notEqual(next.id, task.id); await ready(next.id); assert.equal((await service.getRobotTask(task.id)).status, "cancelled");
  await service.stopRobotTask(next.id, "cancelled");
});
test("task budgets include planning and do not reset when continuing", async () => {
  config.skills.robotTask.maxModelCalls = 1; await saveConfig(aiConfigInputSchema.parse(config)); mock();
  const task = await create(); await control(task, "start"); const paused = await ready(task.id, ["paused", "failed"]); assert.equal(paused.status, "paused"); assert.equal(paused.budget.modelCalls, 1);
  config.skills.robotTask.maxModelCalls = 60; await saveConfig(aiConfigInputSchema.parse(config)); await control(paused, "resume"); assert.equal((await ready(task.id, ["completed", "failed", "paused"])).status, "completed");
});
test("startup recovery and disabled settings preserve checkpoints without automatically executing", async () => {
  const id = await conversation();
  const row = await prisma.aiRobotTask.create({ data: { conversationId: id, goal: "interrupted", selectionJson: "{}", status: "running", runId: "old-process" } });
  await service.recoverRobotTasks(); assert.equal((await service.getRobotTask(row.id)).status, "paused");
  config.skills.globalRobot.enabled = false; await saveConfig(aiConfigInputSchema.parse(config));
  const paused = await service.getRobotTask(row.id); await assert.rejects(control(paused, "resume"), /disabled/);
  config.skills.globalRobot.enabled = true; await saveConfig(aiConfigInputSchema.parse(config));
  await service.stopRobotTask(row.id, "cancelled");
});
test("clearing task conversations removes their history and checkpoints; invalid requests fail before model calls", async () => {
  mock(); const task = await create(); await control(task, "start"); await ready(task.id, ["completed", "failed", "paused"]);
  const response = await messages.DELETE(new Request("http://local"), context(task.conversationId)); assert.equal(response.status, 200);
  assert.equal(await prisma.aiRobotTask.count({ where: { conversationId: task.conversationId } }), 0);
  assert.equal(await prisma.aiRobotMessage.count({ where: { conversationId: task.conversationId } }), 0);
  const invalid = await tasksRoute.POST(new Request("http://local", { method: "POST", body: JSON.stringify({ content: "read", arbitraryTool: "delete" }) }), context(task.conversationId)); assert.equal(invalid.status, 400);
});


test("knowledge scopes include valid descendant bindings and freeze versioned text and subtitle evidence", async () => {
  await prisma.indexNode.create({ data: { id: "child", name: "child", path: "测试/child", parentId: "node", depth: 1 } });
  await prisma.indexNode.create({ data: { id: "unrelated", name: "unrelated", path: "unrelated" } });
  for (const [id, node, sourceType, enabled] of [["text-doc", "node", "BOOK", 1], ["subtitle-doc", "child", "SUBTITLE", 1], ["disabled-doc", "unrelated", "NOTE", 0], ["orphan-doc", "deleted-node", "NOTE", 1]] as const) {
    knowledge.prepare("INSERT INTO KnowledgeDocument(id,title,sourceType,enabled) VALUES(?,?,?,?)").run(id, id, sourceType, enabled);
    knowledge.prepare("INSERT INTO KnowledgeDocumentBinding(id,documentId,indexNodeId,indexPathSnapshot) VALUES(?,?,?,?)").run(id, id, node, node);
    knowledge.prepare("INSERT INTO KnowledgeDocumentVersion(id,documentId,versionNumber,sourceFileName,sourceMimeType,sourceSizeBytes,sourceHash,sourcePath,rawText,status,sourceFormat) VALUES(?,?,1,?,'text/plain',1,?,'fixture','raw','ACTIVE',?)").run(id+"-v1", id, id+".txt", id, sourceType === "SUBTITLE" ? "SRT" : "TXT");
    const locator = sourceType === "SUBTITLE" ? { v: 1, kind: "subtitle", cueStart: 1, cueEnd: 2, startMs: 1000, endMs: 2000 } : { v: 1, kind: "text", lineStart: 1, lineEnd: 2, headingPath: ["支撑"] };
    knowledge.prepare("INSERT INTO KnowledgeChunk(id,versionId,ordinal,sourceCueStart,sourceCueEnd,startMs,endMs,originalText,cleanedText,locatorJson) VALUES(?,?,0,1,2,1000,2000,'支撑','支撑阻力',?)").run(id+"-chunk", id+"-v1", JSON.stringify(locator));
  }
  await prisma.chartImage.update({ where: { id: "image" }, data: { indexNodeId: "child" } });
  const signal = new AbortController().signal;
  const scoped = await sources.buildTaskManifest({ kind: "current", ids: [] }, { indexNodeId: "node" }, 16000, signal);
  assert.deepEqual(scoped.units.filter((unit) => unit.kind === "knowledge").map((unit) => unit.id).sort(), ["subtitle-doc-chunk", "text-doc-chunk"]);
  const fallback = await sources.buildTaskManifest({ kind: "current", ids: [] }, { imageId: "image" }, 16000, signal);
  assert.equal(fallback.units.filter((unit) => unit.kind === "knowledge").length, 2);
  const whole = await sources.buildTaskManifest({ kind: "library", ids: [] }, {}, 16000, signal);
  assert.equal(whole.units.filter((unit) => unit.kind === "knowledge").length, 2);
  const emptyIndex = await sources.buildTaskManifest({ kind: "indexes", ids: ["unrelated"] }, {}, 16000, signal); assert.equal(emptyIndex.units.length, 1); assert.equal(emptyIndex.units[0].kind, "index"); assert.match((await sources.readTaskUnit(emptyIndex.units[0], signal)).text, /unrelated/);
  const explicitDoc = await sources.buildTaskManifest({ kind: "documents", ids: ["text-doc"] }, {}, 16000, signal); assert.deepEqual(explicitDoc.units.filter((unit) => unit.kind === "knowledge").map((unit) => unit.id), ["text-doc-chunk"]); assert.equal(explicitDoc.units.filter((unit) => unit.kind === "image").length, 0);
  const unit = scoped.units.find((unit) => unit.id === "text-doc-chunk")!;
  const saved = await sources.readTaskUnit(unit, signal); assert.equal(saved.version, "text-doc-v1"); assert.match(saved.location!, /支撑/);
  const toolContext = { scope: { kind: "library" as const }, runId: "scope", signal, currentImageId: null, currentIndexNodeId: null };
  const search = await sources.createRobotTaskRegistry(scoped).get("search_knowledge")!.execute({ query: "支撑", offset: 0, limit: 1 }, toolContext) as { sources: unknown[]; totalCandidates: number; nextOffset: number }; assert.equal(search.totalCandidates, 2); assert.equal(search.sources.length, 1); assert.equal(search.nextOffset, 1);
  knowledge.prepare("UPDATE KnowledgeDocumentVersion SET status='ARCHIVED' WHERE id='text-doc-v1'").run();
  await assert.rejects(sources.validateTaskManifest(scoped, signal), /source_changed/); assert.equal(saved.text, "支撑阻力");
  knowledge.prepare("UPDATE KnowledgeDocumentVersion SET status='ACTIVE' WHERE id='text-doc-v1'").run();
  await prisma.chartImage.update({ where: { id: "image" }, data: { indexNodeId: null } });
});

test("cancelling an upstream that ignores abort returns immediately and cannot commit a late answer", async () => {
  mock(); const task = await create();
  let resolve!: (value: Response) => void, entered!: () => void;
  const started = new Promise<void>((done) => { entered = done; });
  globalThis.fetch = async () => { entered(); return new Promise<Response>((done) => { resolve = done; }); };
  await control(task, "start"); await started;
  const cancelled = await control(await service.getRobotTask(task.id), "cancel"); assert.equal(cancelled.status, "cancelled");
  resolve(turnResponse("late answer [T1]")); await new Promise((done) => setTimeout(done, 20));
  assert.equal((await service.getRobotTask(task.id)).checkpointCount, 0);
  assert.equal(await prisma.aiRobotMessage.count({ where: { conversationId: task.conversationId, role: "ASSISTANT" } }), 0);
});

test("resume validates already completed resources and preserves checkpoints on a model failure", async () => {
  mock(); const task = await create("long"); let calls = 0;
  globalThis.fetch = async () => { if (++calls === 2) return new Response("upstream error", { status: 500 }); return turnResponse("saved [T1]"); };
  await control(task, "start"); const failed = await ready(task.id, ["failed", "paused"]); assert.equal(failed.status, "failed"); assert.equal(failed.completedBatches, 1);
  const original = (await prisma.chartImage.findUniqueOrThrow({ where: { id: "long" } })).notes;
  await prisma.chartImage.update({ where: { id: "long" }, data: { notes: original + " changed" } });
  mock(); await control(failed, "resume"); const paused = await ready(task.id, ["failed", "paused"]); assert.equal(paused.status, "paused"); assert.equal(paused.completedBatches, 1); assert.match(paused.error!, /版本/);
  await service.stopRobotTask(task.id, "cancelled");
});


test("model errors preserve budgets and retry finishes without redoing saved batches", async () => {
  mock(); const task = await create();
  globalThis.fetch = async () => new Response("failure", { status: 503 });
  await control(task, "start"); const failed = await ready(task.id, ["failed", "paused"]); assert.equal(failed.status, "failed"); assert.equal(failed.budget.modelCalls, 2);
  mock(); await control(failed, "resume"); const done = await ready(task.id, ["completed", "failed", "paused"]); assert.equal(done.status, "completed", done.error ?? ""); assert.ok(done.budget.modelCalls > failed.budget.modelCalls);
});

test("disabling the robot pauses an active task before an ignored abort can write back", async () => {
  mock(); const task = await create(); let entered!: () => void, resolve!: (value: Response) => void;
  const started = new Promise<void>((done) => { entered = done; });
  globalThis.fetch = async () => { entered(); return new Promise<Response>((done) => { resolve = done; }); };
  await control(task, "start"); await started;
  config.skills.globalRobot.enabled = false; await saveConfig(aiConfigInputSchema.parse(config));
  const paused = await service.getRobotTask(task.id); assert.equal(paused.status, "paused"); assert.match(paused.error!, /关闭/);
  resolve(turnResponse("late reply")); await new Promise((done) => setTimeout(done, 10)); assert.equal((await service.getRobotTask(task.id)).checkpointCount, 0);
  config.skills.globalRobot.enabled = true; await saveConfig(aiConfigInputSchema.parse(config));
  mock(); await control(await service.getRobotTask(task.id), "resume"); assert.equal((await ready(task.id, ["completed", "failed", "paused"])).status, "completed");
});


test("active time is checkpointed during pending model calls and stops accumulating while paused", async () => {
  mock(); const task = await create(); let entered!: () => void, resolve!: (value: Response) => void;
  const started = new Promise<void>((done) => { entered = done; });
  globalThis.fetch = async () => { entered(); return new Promise<Response>((done) => { resolve = done; }); };
  await control(task, "start"); await started; await new Promise((done) => setTimeout(done, 1100));
  const running = await service.getRobotTask(task.id); assert.ok(running.budget.elapsedMs >= 900);
  const paused = await control(running, "pause"); await new Promise((done) => setTimeout(done, 100));
  assert.equal((await service.getRobotTask(task.id)).budget.elapsedMs, paused.budget.elapsedMs);
  resolve(turnResponse("late")); await service.stopRobotTask(task.id, "cancelled");
});


test("task planning shares semantic search, reserves Embedding usage before requests, and requires confirmation", async () => {
  const previous = structuredClone(config);
  config.embeddingEndpoints = [{ id: "embed", name: "Embed", provider: "custom", baseUrl: "https://embedding.test/v1", apiKey: "secret", useCustomUrls: false, embeddingsUrl: "", modelsUrl: "", models: [], embeddingModel: "semantic" }];
  config.activeEmbeddingEndpointId = "embed";
  await saveConfig(aiConfigInputSchema.parse(config));
  knowledge.prepare("INSERT INTO KnowledgeEmbeddingProfile(id,endpointId,model,dimensions,status) VALUES('semantic-profile','embed','semantic',3,'ACTIVE')").run();
  knowledge.prepare("INSERT INTO KnowledgeChunkEmbedding(chunkId,profileId,embedding) VALUES('text-doc-chunk','semantic-profile',?)").run(vectorBuffer([1, 0, 0]));
  let modelCalls = 0, embeddingCalls = 0;
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    if (body.input) {
      embeddingCalls++;
      const row = await prisma.aiRobotTask.findFirstOrThrow({ where: { status: "planning" }, orderBy: { createdAt: "desc" } });
      const saved = JSON.parse(row.budgetJson);
      assert.equal(saved.embeddingRequests, 1); assert.ok(saved.estimatedEmbeddingInputTokens > 0);
      return Response.json({ data: [{ index: 0, embedding: [1, 0, 0] }] });
    }
    if (++modelCalls === 1) return turnResponse(null, [{ id: "semantic-discovery", name: "search_knowledge", arguments: '{"query":"support","scope":"documents","documentIds":["text-doc"]}' }]);
    if (modelCalls === 2) {
      const result = JSON.parse(body.messages.find((message: { role: string }) => message.role === "tool").content).data;
      assert.equal(result.semanticSearchUsed, true); assert.equal(result.sources[0].id, "text-doc-chunk"); assert.equal(result.sources[0].citation, "");
      return turnResponse(JSON.stringify({ ...plan, scope: { kind: "documents", ids: ["text-doc"] } }));
    }
    return turnResponse(body.messages[0].content.includes("现在所有") ? "最终课程总结 [T1]" : "课程笔记 [T1]");
  };
  try {
    const task = await create(); assert.equal(task.status, "awaiting_confirmation", task.error ?? ""); assert.equal(task.checkpointCount, 0);
    assert.equal(task.budget.embeddingRequests, 1); assert.equal(embeddingCalls, 1); assert.equal(task.budget.modelCalls, 2);
    await control(task, "start"); const done = await ready(task.id, ["completed", "failed", "paused"]);
    assert.equal(done.status, "completed", done.error ?? ""); assert.equal(done.budget.embeddingRequests, 1); assert.match(done.result!, /\[T1\]/);
  } finally {
    knowledge.prepare("DELETE FROM KnowledgeChunkEmbedding WHERE profileId='semantic-profile'").run();
    knowledge.prepare("DELETE FROM KnowledgeEmbeddingProfile WHERE id='semantic-profile'").run();
    Object.assign(config, previous); await saveConfig(aiConfigInputSchema.parse(config)); mock();
  }
});
