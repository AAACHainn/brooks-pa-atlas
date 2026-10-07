import assert from "node:assert/strict";
import test from "node:test";
import { clampRobotFrame, resizeRobotFrame, parseRobotFrame, robotWasDragged, consumeRobotStream, updateRobotDraft, readRobotJson, fetchRobotJson } from "@/lib/ai-robot-ui";
import { robotErrorMessage } from "@/lib/ai-robot-types";
import type { RobotStreamEvent } from "@/lib/ai-robot-types";

test("robot geometry clamps restored frames, supports resize, and distinguishes drag from click", () => {
  const viewport = { width: 800, height: 600 };
  assert.deepEqual(clampRobotFrame({ x: 999, y: -1, width: 1000, height: 1000 }, viewport), { x: 12, y: 12, width: 776, height: 576 });
  assert.deepEqual(resizeRobotFrame({ x: 100, y: 100, width: 400, height: 400 }, "nw", -200, -200, viewport), { x: 12, y: 12, width: 488, height: 488 });
  assert.equal(parseRobotFrame({ x: NaN, y: 0, width: 400, height: 400 }), null);
  assert.equal(robotWasDragged(2, 2), false); assert.equal(robotWasDragged(6, 0), true);
});
test("round boundaries replace intermediate text and keep separate tool progress", () => {
  let draft = updateRobotDraft(null, { type: "delta", runId: "run", round: 1, channel: "content", text: "正在查询" });
  draft = updateRobotDraft(draft, { type: "trace", record: { runId: "run", at: "now", type: "tool_started", callId: "a", toolName: "list_index_nodes", status: "running" } });
  draft = updateRobotDraft(draft, { type: "trace", record: { runId: "run", at: "now", type: "model_started", round: 2 } });
  draft = updateRobotDraft(draft, { type: "delta", runId: "run", round: 2, channel: "content", text: "最终答案" });
  assert.equal(draft?.text, "最终答案"); assert.equal(draft?.tools[0].name, "list_index_nodes");
  assert.equal(updateRobotDraft(draft, { type: "error", code: "cancelled", error: "Stopped" }), null);
});
test("NDJSON assembles Chinese byte fragments and requires a terminal event", async () => {
  const bytes = new TextEncoder().encode(JSON.stringify({ type: "delta", runId: "r", round: 1, channel: "content", text: "中文" }) + "\n" + JSON.stringify({ type: "error", code: "cancelled", error: "已停止" }) + "\n");
  const response = new Response(new ReadableStream({ start(controller) { for (const byte of bytes) controller.enqueue(new Uint8Array([byte])); controller.close(); } }));
  const events: RobotStreamEvent[] = [];
  await consumeRobotStream(response, (event) => events.push(event), new AbortController().signal);
  assert.equal(events.length, 2); assert.equal(events[0].type === "delta" && events[0].text, "中文");
  await assert.rejects(consumeRobotStream(new Response('{"type":"ping"}\n'), () => {}, new AbortController().signal), /Incomplete/);
});
test("stream cancellation stops a pending reader", async () => {
  const controller = new AbortController();
  const response = new Response(new ReadableStream());
  const reading = consumeRobotStream(response, () => {}, controller.signal);
  controller.abort(); await assert.rejects(reading, { name: "AbortError" });
});

test("conversation HTTP errors are localized and do not display raw server diagnostics", async () => {
  await assert.rejects(readRobotJson(Response.json({ code: "storage_upgrade_required", error: "private server details" }, { status: 503 }), "zh"),
    { message: robotErrorMessage("storage_upgrade_required", "zh") });
  await assert.rejects(readRobotJson(new Response("<html>private database path</html>", { status: 500 }), "zh"),
    { message: robotErrorMessage("execution_failed", "zh") });
  await assert.rejects(readRobotJson(new Response("not json"), "en"),
    { message: robotErrorMessage("invalid_response_body", "en") });
  assert.deepEqual(await readRobotJson(Response.json({ conversations: [] }), "zh"), { conversations: [] });
});

test("conversation network errors are actionable while cancellation is preserved", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => { throw new TypeError("fetch failed"); };
    await assert.rejects(fetchRobotJson("http://localhost", "zh"), { message: robotErrorMessage("network_error", "zh") });
    const signal = AbortSignal.abort();
    globalThis.fetch = async () => { signal.throwIfAborted(); return Response.json({}); };
    await assert.rejects(fetchRobotJson("http://localhost", "en", { signal }), { name: "AbortError" });
  } finally { globalThis.fetch = originalFetch; }
});
