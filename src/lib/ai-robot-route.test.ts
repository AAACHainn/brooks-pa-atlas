import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { mkdtemp, readFile, readdir, unlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import type { PrismaClient } from "@/generated/prisma/client";
import { AI_CONFIG_SETTING_KEY, aiConfigInputSchema } from "@/lib/ai-config";
import { toolTestConfig, turnResponse, sseResponse } from "@/lib/ai-tool-test-helpers";
import type { RobotStreamEvent } from "@/lib/ai-robot-types";

let prisma: PrismaClient;
let collection: typeof import("@/app/api/ai/robot/conversations/route");
let conversation: typeof import("@/app/api/ai/robot/conversations/[id]/route");
let messages: typeof import("@/app/api/ai/robot/conversations/[id]/messages/route");
let saveConfig: typeof import("@/lib/ai-settings").saveAiConfig;
let directory: string;
const originalFetch = globalThis.fetch, previousUrl = process.env.DATABASE_URL;
const robotMigration = "20261006100000_ai_robot";
const modesMigration = "20261007000000_robot_modes_tasks";
const knowledgeMigration = "20261009000000_robot_knowledge_sources";
const config = toolTestConfig();
const context = (id: string) => ({ params: Promise.resolve({ id }) });
function request(content = "查询当前图片", extra: Record<string, unknown> = {}, signal?: AbortSignal) {
  return new Request("http://localhost/api/ai/robot", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content, locale: "zh", imageId: "image", indexNodeId: "node", ...extra }), signal });
}
async function create() { const response = await collection.POST(); return (await response.json()).conversation.id as string; }
async function events(response: Response) { return (await response.text()).trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as RobotStreamEvent); }
async function resetConfig() { config.skills.globalRobot.enabled = true; config.skills.globalRobot.modelOverride = "robot-model"; await saveConfig(aiConfigInputSchema.parse(config)); }
before(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "atlas-ai-robot-"));
  process.env.DATABASE_URL = `file:${path.join(directory, "main.db")}`;
  const db = new Database(path.join(directory, "main.db"));
  const root = path.join(process.cwd(), "prisma/migrations");
  for (const entry of (await readdir(root)).sort()) { if (entry !== "migration_lock.toml" && entry !== robotMigration && entry !== modesMigration && entry !== knowledgeMigration) db.exec(await readFile(path.join(root, entry, "migration.sql"), "utf8")); }
  db.close();
  prisma = (await import("@/lib/db")).prisma;
  collection = await import("@/app/api/ai/robot/conversations/route");
  conversation = await import("@/app/api/ai/robot/conversations/[id]/route");
  messages = await import("@/app/api/ai/robot/conversations/[id]/messages/route");
  saveConfig = (await import("@/lib/ai-settings")).saveAiConfig;
  await prisma.indexNode.create({ data: { id: "node", name: "图表", path: "图表" } });
  await prisma.chartImage.create({ data: { id: "image", title: "当前图表", originalName: "chart.png", libraryPath: "images/chart.png", hash: "a".repeat(64), sizeBytes: 10, mimeType: "image/png", indexNodeId: "node", notes: "测试备注", ocrText: "最新OCR" } });
  await resetConfig();
});
after(async () => {
  globalThis.fetch = originalFetch; await prisma?.$disconnect();
  if (previousUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previousUrl;
  await unlink(path.join(directory, "main.db"));
});

test("an existing database without the robot migration reports an upgrade and recovers after migration", async () => {
  let modelCalls = 0;
  globalThis.fetch = async () => { modelCalls++; return turnResponse("should not run"); };
  try {
    const responses = [
      await collection.GET(), await collection.POST(),
      await conversation.GET(new Request("http://localhost"), context("missing")),
      await conversation.PATCH(new Request("http://localhost", { method: "PATCH", body: JSON.stringify({ title: "title" }) }), context("missing")),
      await conversation.DELETE(new Request("http://localhost"), context("missing")),
      await messages.DELETE(new Request("http://localhost"), context("missing")),
      await messages.POST(request(), context("missing")),
    ];
    for (const response of responses) {
      assert.equal(response.status, 503);
      const body = await response.json();
      assert.equal(body.code, "storage_upgrade_required");
      assert.match(body.error, /npm run db:migrate/);
      assert.ok(!JSON.stringify(body).includes("private-test-key"));
      assert.ok(!JSON.stringify(body).includes(directory));
    }
    assert.equal(modelCalls, 0);
    assert.equal(await prisma.chartImage.count(), 1);
    assert.equal(await prisma.indexNode.count(), 1);
  } finally {
    const db = new Database(path.join(directory, "main.db"));
    try { for (const migration of [robotMigration, modesMigration, knowledgeMigration]) db.exec(await readFile(path.join(process.cwd(), "prisma/migrations", migration, "migration.sql"), "utf8")); }
    finally { db.close(); }
  }
  const id = await create();
  const list = await (await collection.GET()).json();
  assert.ok(list.conversations.some((row: { id: string }) => row.id === id));
  assert.equal(await prisma.chartImage.count(), 1);
  assert.equal(await prisma.indexNode.count(), 1);
});

test("robot performs real tool reads, preserves protocol state, and saves only the final answer", async () => {
  const id = await create(); let calls = 0;
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    assert.equal(body.model, "robot-model");
    assert.deepEqual(body.tools.map((tool: { function: { name: string } }) => tool.function.name).sort(), ["get_image_context", "list_index_nodes", "list_knowledge_documents", "read_knowledge", "search_knowledge"]);
    assert.ok(!JSON.stringify(body).includes("image_url"));
    if (++calls === 1) return turnResponse("先查询目录", [{ id: "indices", name: "list_index_nodes", arguments: '{"query":"图表"}' }], {});
    if (calls === 2) {
      assert.equal(JSON.parse(body.messages.at(-1).content).data.nodes[0].id, "node");
      return sseResponse([
        { choices: [{ delta: { reasoning_content: "读取资料" }, finish_reason: null }] },
        { choices: [{ delta: { tool_calls: [{ index: 0, id: "image-read", type: "function", function: { name: "get_image_context", arguments: '{"imageId":"image"}' } }] }, finish_reason: "tool_calls" }] },
      ], { byteChunks: 2 });
    }
    assert.equal(JSON.parse(body.messages.at(-1).content).data.snapshot.ocr.text, "最新OCR");
    assert.ok(body.messages.some((message: { reasoning_content?: string }) => message.reasoning_content === "读取资料"));
    return turnResponse("当前图表包含最新OCR");
  };
  const output = await events(await messages.POST(request(), context(id)));
  const done = output.find((event) => event.type === "done");
  assert.equal(done?.type === "done" && done.message.content, "当前图表包含最新OCR", JSON.stringify(output));
  assert.equal(done?.type === "done" && done.message.execution?.toolCalls, 2);
  const rows = await prisma.aiRobotMessage.findMany({ where: { conversationId: id }, orderBy: { sequence: "asc" } });
  assert.equal(rows.length, 2); assert.equal(rows[0].role, "USER"); assert.equal(rows[1].reasoningContent, "读取资料");
  assert.ok(!rows[1].content.includes("先查询目录"));
  assert.ok(!rows[1].executionJson?.includes("最新OCR")); assert.ok(!rows[1].executionJson?.includes("private-test-key"));
  assert.ok(output.some((event) => event.type === "trace" && event.record.type === "tool_completed"));
});

test("plain chat needs no tool call and only the latest four complete pairs enter history", async () => {
  const id = await create();
  const data = Array.from({ length: 6 }, (_, i) => [
    { conversationId: id, role: "USER", sequence: i * 2, content: `question-${i}` },
    { conversationId: id, role: "ASSISTANT", sequence: i * 2 + 1, content: `answer-${i}` },
  ]).flat();
  await prisma.aiRobotMessage.createMany({ data: [...data, { conversationId: id, role: "USER", sequence: 12, content: "failed-question" }] });
  await prisma.aiRobotConversation.update({ where: { id }, data: { nextTurn: 7 } });
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    const questions = body.messages.filter((message: { role: string }) => message.role === "user");
    assert.equal(questions.length, 5); assert.equal(questions[0].content, "question-2");
    assert.ok(!JSON.stringify(body).includes("failed-question")); return turnResponse("你好");
  };
  const output = await events(await messages.POST(request("你好", { imageId: null, indexNodeId: null }), context(id)));
  assert.ok(output.some((event) => event.type === "done" && event.message.execution?.toolCalls === 0));
});

test("invalid arguments and unknown tools can be corrected; unregistered write tools never execute", async () => {
  const id = await create(); let call = 0;
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    if (++call === 1) return turnResponse(null, [{ id: "invalid", name: "get_image_context", arguments: '{}' }, { id: "write", name: "delete_image", arguments: '{"imageId":"image"}' }]);
    if (call === 2) assert.equal(JSON.parse(body.messages.at(-1).content).ok, false);
    if (call === 2) return turnResponse(null, [{ id: "corrected", name: "get_image_context", arguments: '{"imageId":"image"}' }]);
    return turnResponse("已读取图片资料");
  };
  const output = await events(await messages.POST(request(), context(id)));
  assert.ok(output.some((event) => event.type === "done" && event.message.execution?.successfulToolCalls === 1), JSON.stringify(output));
  assert.ok(await prisma.chartImage.findUnique({ where: { id: "image" } }));
});

test("selection is fixed at submission and historical references survive image deletion", async () => {
  const id = await create();
  globalThis.fetch = async (_url, init) => { const body = JSON.parse(String(init?.body)); assert.ok(body.messages.some((row: { content: string }) => row.content.includes('"currentImageId":"image"'))); return turnResponse("已参考当前选择"); };
  await events(await messages.POST(request(), context(id)));
  const saved = await prisma.aiRobotMessage.findFirstOrThrow({ where: { conversationId: id, role: "USER" } });
  assert.equal(JSON.parse(saved.selectionJson!).image.title, "当前图表");
  // No foreign key to the source resource: a saved selection remains independent.
  await prisma.chartImage.update({ where: { id: "image" }, data: { title: "后来的标题" } });
  const history = await (await conversation.GET(new Request("http://localhost"), context(id))).json();
  assert.equal(history.messages[0].selection.image.title, "当前图表");
  const original = await prisma.chartImage.findUniqueOrThrow({ where: { id: "image" } });
  await prisma.chartImage.create({ data: { ...original, id: "deletable", hash: "b".repeat(64), libraryPath: "images/deletable.png" } });
  const other = await create();
  globalThis.fetch = async () => turnResponse("保留参考对象");
  await events(await messages.POST(request("reference", { imageId: "deletable" }), context(other)));
  await prisma.chartImage.delete({ where: { id: "deletable" } });
  const afterDeletion = await (await conversation.GET(new Request("http://localhost"), context(other))).json();
  assert.equal(afterDeletion.messages[0].selection.image.id, "deletable");
  assert.equal(afterDeletion.messages[0].selection.image.originalName, "chart.png");
});

test("clear/delete locks serialize mutations and prevent new sends until completion", async () => {
  const { acquireRobotRun, releaseRobotRun, mutateRobotConversation, cancelAllRobotRuns } = await import("@/lib/ai-robot-runs");
  let release!: () => void, started!: () => void;
  const ready = new Promise<void>((resolve) => { started = resolve; });
  const first = mutateRobotConversation("lock-test", async () => { started(); await new Promise<void>((resolve) => { release = resolve; }); });
  await ready;
  const order: string[] = [];
  const second = mutateRobotConversation("lock-test", async () => { order.push("second"); });
  assert.equal(acquireRobotRun("lock-test"), null);
  cancelAllRobotRuns(); assert.equal(acquireRobotRun("lock-test"), null);
  assert.deepEqual(order, []); release(); await first; await second;
  assert.deepEqual(order, ["second"]);
  const lease = acquireRobotRun("lock-test")!; assert.ok(lease); releaseRobotRun(lease);
});

test("CRUD and pagination stay separate from reading companion conversations", async () => {
  const id = await create();
  const reading = await prisma.aiReadingConversation.create({ data: { title: "伴读独立会话" } });
  await prisma.aiRobotMessage.createMany({ data: Array.from({ length: 45 }, (_, sequence) => ({ conversationId: id, sequence, role: sequence % 2 ? "ASSISTANT" : "USER", content: `${sequence}` })) });
  const first = await (await conversation.GET(new Request("http://localhost"), context(id))).json();
  assert.equal(first.messages.length, 40); assert.equal(first.nextBefore, 5);
  const second = await (await conversation.GET(new Request("http://localhost?before=5"), context(id))).json();
  assert.equal(second.messages.length, 5); assert.equal(second.nextBefore, null);
  assert.equal((await conversation.GET(new Request("http://localhost?before=bad"), context(id))).status, 400);
  await conversation.PATCH(new Request("http://localhost", { method: "PATCH", body: JSON.stringify({ title: "新名称" }) }), context(id));
  const list = await (await collection.GET()).json(); assert.ok(list.conversations.some((row: { title: string }) => row.title === "新名称"));
  assert.ok(!list.conversations.some((row: { id: string }) => row.id === reading.id));
  await messages.DELETE(new Request("http://localhost"), context(id));
  assert.equal(await prisma.aiRobotMessage.count({ where: { conversationId: id } }), 0);
  await conversation.DELETE(new Request("http://localhost"), context(id));
  assert.ok(await prisma.aiReadingConversation.findUnique({ where: { id: reading.id } }));
});

test("disabled, malformed, missing-resource and unsupported-model requests never become successful answers", async () => {
  const id = await create(); let calls = 0;
  globalThis.fetch = async () => { calls++; return Response.json({ error: { message: "tools are not supported" } }, { status: 400 }); };
  config.skills.globalRobot.enabled = false; await saveConfig(aiConfigInputSchema.parse(config));
  assert.equal((await messages.POST(request(), context(id))).status, 403); assert.equal(calls, 0);
  await resetConfig();
  assert.equal((await messages.POST(request("hi", { allowedTools: ["delete_image"] }), context(id))).status, 400);
  assert.equal((await messages.POST(request("hi", { imageId: "missing" }), context(id))).status, 404);
  assert.equal(calls, 0);
  const output = await events(await messages.POST(request(), context(id)));
  assert.ok(output.some((event) => event.type === "error" && event.code === "unsupported-tools"));
  assert.equal(await prisma.aiRobotMessage.count({ where: { conversationId: id, role: "ASSISTANT" } }), 0);
});

test("busy conversations, clearing, deleting and disabling abort runs and reject late completion", async () => {
  for (const operation of ["abort", "clear", "delete", "disable"] as const) {
    await resetConfig(); const id = await create(); const abort = new AbortController();
    let resolve!: (value: Response) => void, notify!: () => void;
    const started = new Promise<void>((done) => { notify = done; });
    globalThis.fetch = async () => { notify(); return new Promise<Response>((done) => { resolve = done; }); };
    const response = await messages.POST(request("pending", {}, abort.signal), context(id));
    await started;
    assert.equal((await messages.POST(request("another"), context(id))).status, 409);
    if (operation === "abort") abort.abort();
    if (operation === "clear") await messages.DELETE(new Request("http://localhost"), context(id));
    if (operation === "delete") await conversation.DELETE(new Request("http://localhost"), context(id));
    if (operation === "disable") { config.skills.globalRobot.enabled = false; await saveConfig(aiConfigInputSchema.parse(config)); }
    resolve(turnResponse("迟到的回答"));
    const output = await events(response);
    assert.ok(!output.some((event) => event.type === "done"));
    if (operation !== "abort") assert.ok(output.some((event) => event.type === "error" && event.code === "cancelled"));
    assert.equal(await prisma.aiRobotMessage.count({ where: { conversationId: id, role: "ASSISTANT" } }), 0);
    if (operation === "clear" || operation === "delete") assert.equal(await prisma.aiRobotMessage.count({ where: { conversationId: id } }), 0);
  }
  await resetConfig();
});

test("oversized current question fails budget validation without an upstream request or truncation", async () => {
  const id = await create(); let calls = 0;
  globalThis.fetch = async () => { calls++; return turnResponse("should not run"); };
  const question = "汉".repeat(19_000);
  const output = await events(await messages.POST(request(question), context(id)));
  assert.equal(calls, 0); assert.ok(output.some((event) => event.type === "error" && event.code === "budget_exceeded"));
  const failure = output.find((event) => event.type === "error");
  assert.equal(failure?.type === "error" && failure.budget?.limitKind, "input_tokens");
  assert.ok(failure?.type === "error" && failure.budget!.nextInputTokens > failure.budget!.limits.inputTokenBudget);
  assert.equal((await prisma.aiRobotMessage.findFirstOrThrow({ where: { conversationId: id } })).content, question);
  const setting = await prisma.appSetting.findUniqueOrThrow({ where: { key: AI_CONFIG_SETTING_KEY } });
  assert.ok(setting.value.includes("private-test-key"));
});

test("robot saved limits allow more calls, fix the run snapshot, and cannot be overridden by the send body", async () => {
  const previous = { ...config.skills.globalRobot };
  const id = await create(); let calls = 0;
  try {
    Object.assign(config.skills.globalRobot, { maxModelCalls: 12, maxToolCalls: 24, maxOutputTokens: 1_234, runTimeoutSeconds: 420 });
    await resetConfig();
    globalThis.fetch = async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      assert.equal(body.max_tokens ?? body.max_completion_tokens, 1_234);
      if (++calls === 1) {
        config.skills.globalRobot.maxModelCalls = 1; config.skills.globalRobot.maxToolCalls = 1;
        await resetConfig();
      }
      if (calls <= 7) return turnResponse(null, [0, 1].map((index) => ({ id: `read-${calls}-${index}`, name: "list_index_nodes", arguments: '{"query":"图表","limit":1}' })));
      return turnResponse("根据实际读取生成最终答案");
    };
    assert.equal((await messages.POST(request("forged", { limits: { maxModelCalls: 50 } }), context(id))).status, 400);
    assert.equal(calls, 0);
    const output = await events(await messages.POST(request("多次查询"), context(id)));
    const done = output.find((event) => event.type === "done");
    assert.equal(done?.type, "done", JSON.stringify(output));
    if (done?.type === "done") {
      assert.equal(done.message.execution?.modelCalls, 8); assert.equal(done.message.execution?.toolCalls, 14);
      assert.equal(done.message.execution?.budget?.limits.maxModelCalls, 12);
      assert.equal(done.message.execution?.budget?.limits.maxToolCalls, 24);
      assert.equal(done.message.execution?.budget?.limits.runTimeoutMs, 420_000);
      assert.doesNotMatch(JSON.stringify(done.message.execution), /private-test-key|"query"|"arguments"/);
    }
  } finally { config.skills.globalRobot = previous; await resetConfig(); }
});

test("near-limit answers warn users and retain the completed read statistics in history", async () => {
  const previous = { ...config.skills.globalRobot };
  const id = await create(); let calls = 0;
  try {
    config.skills.globalRobot.maxModelCalls = 2; await resetConfig();
    globalThis.fetch = async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      if (++calls === 1) return turnResponse(null, [{ id: "read", name: "get_image_context", arguments: '{"imageId":"image","fields":["ocr"]}' }]);
      assert.equal(body.tool_choice, "none");
      assert.equal(JSON.parse(body.messages.find((message: { role: string }) => message.role === "tool").content).data.snapshot.ocr.text, "最新OCR");
      return turnResponse("已读取当前 OCR。其余资料尚未查询，可继续询问具体范围。");
    };
    const output = await events(await messages.POST(request(), context(id)));
    assert.ok(output.some((event) => event.type === "trace" && event.record.type === "budget_warning"));
    const done = output.find((event) => event.type === "done");
    assert.ok(done?.type === "done" && done.message.execution?.warnings?.includes("approaching_limit"));
    const saved = await prisma.aiRobotMessage.findFirstOrThrow({ where: { conversationId: id, role: "ASSISTANT" } });
    assert.ok(JSON.parse(saved.executionJson!).warnings.includes("approaching_limit"));
    assert.equal(JSON.parse(saved.executionJson!).budget.successfulToolCalls, 1);
  } finally { config.skills.globalRobot = previous; await resetConfig(); }
});

test("raising the input budget accepts an intact question that failed the default budget", async () => {
  const previous = { ...config.skills.globalRobot };
  const id = await create(), question = "汉".repeat(19_000);
  try {
    Object.assign(config.skills.globalRobot, { inputTokenBudget: 64_000, totalInputTokenBudget: 200_000 }); await resetConfig();
    let calls = 0;
    globalThis.fetch = async (_url, init) => {
      calls++; const body = JSON.parse(String(init?.body));
      assert.equal(body.messages.at(-1).content, question);
      return turnResponse("完整问题已收到");
    };
    const output = await events(await messages.POST(request(question), context(id)));
    assert.equal(calls, 1); assert.ok(output.some((event) => event.type === "done"));
    assert.equal((await prisma.aiRobotMessage.findFirstOrThrow({ where: { conversationId: id, role: "USER" } })).content, question);
  } finally { config.skills.globalRobot = previous; await resetConfig(); }
});
