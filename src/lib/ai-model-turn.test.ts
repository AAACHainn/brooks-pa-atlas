import assert from "node:assert/strict";
import test from "node:test";
import { AiServiceError, createAiChatCompletion, createAiModelTurn, streamAiChatCompletionEvents, streamAiModelTurn } from "@/lib/ai-client";
import type { AiFunctionDefinition, AiModelStreamEvent } from "@/lib/ai-model-types";
import { sseResponse, toolTestConfig, turnResponse } from "@/lib/ai-tool-test-helpers";

const endpoint = toolTestConfig().endpoints[0];
const tool: AiFunctionDefinition = { name: "get_image_context", description: "Read an image", parameters: { type: "object", properties: { imageId: { type: "string" } } } };
const call = { id: "call-1", name: tool.name, arguments: '{"imageId":"图片甲"}' };

test("structured turns accept tool-only responses and serialize tool results with their matching ID", async () => {
  let body: Record<string, unknown> = {};
  const turn = await createAiModelTurn(endpoint, "mock", [{ role: "user", content: "read" },
    { role: "assistant", content: null, toolCalls: [call], providerState: { reasoning_content: "keep", arbitrary: "drop" } },
    { role: "tool", callId: call.id, content: '{"ok":true}' }], {
    tools: [tool], toolChoice: { name: tool.name }, fetchImpl: async (_url, init) => {
      body = JSON.parse(String(init?.body));
      return Response.json({ choices: [{ message: { content: null, tool_calls: [{ id: call.id, type: "function", function: { name: call.name, arguments: call.arguments } }],
        reasoning_content: "thinking", reasoning_details: [{ type: "reasoning.encrypted", data: "opaque" }] }, finish_reason: "tool_calls" }], usage: { prompt_tokens: 30, completion_tokens: 8 } });
    },
  });
  assert.deepEqual(turn.message.toolCalls, [call]);
  assert.equal(turn.message.content, null);
  assert.equal(turn.reasoning, "thinking");
  assert.equal(turn.usage.inputTokens, 30);
  assert.deepEqual((body.messages as Record<string, unknown>[])[2], { role: "tool", tool_call_id: call.id, content: '{"ok":true}' });
  assert.deepEqual((body.messages as Record<string, unknown>[])[1], { role: "assistant", content: null, reasoning_content: "keep",
    tool_calls: [{ id: call.id, type: "function", function: { name: call.name, arguments: call.arguments } }] });
  assert.deepEqual(body.tool_choice, { type: "function", function: { name: tool.name } });
  assert.equal(JSON.stringify(body).includes("arbitrary"), false);
});

test("stream assembly handles interleaved tools, name fragments, split UTF-8 and usage-only frames", async () => {
  const chunk = (delta: unknown, finish_reason: string | null = null) => ({ choices: [{ delta, finish_reason }] });
  const payloads = [
    chunk({ reasoning_content: "先看" }),
    chunk({ tool_calls: [{ index: 1, id: "b", type: "function", function: { name: "list_", arguments: "{" } }] }),
    chunk({ content: "正在查询", tool_calls: [{ index: 0, id: "a", type: "function", function: { name: "get_image_context", arguments: '{"imageId":"图' } }] }),
    chunk({ reasoning_content: "图片", tool_calls: [{ index: 1, function: { name: "index_nodes", arguments: '"query":"甲"}' } }, { index: 0, function: { arguments: '片甲"}' } }] }),
    chunk({}, "tool_calls"), { choices: [], usage: { prompt_tokens: 50, completion_tokens: 20 } },
  ];
  const events: AiModelStreamEvent[] = [];
  for await (const event of streamAiModelTurn(endpoint, "mock", [{ role: "user", content: "read" }], { tools: [tool],
    fetchImpl: async () => sseResponse(payloads, { byteChunks: 1 }) })) events.push(event);
  const final = events.at(-1);
  assert.equal(final?.type, "complete");
  if (final?.type !== "complete") return;
  assert.deepEqual(final.turn.message.toolCalls, [{ id: "a", name: tool.name, arguments: '{"imageId":"图片甲"}' }, { id: "b", name: "list_index_nodes", arguments: '{"query":"甲"}' }]);
  assert.equal(final.turn.message.content, "正在查询");
  assert.equal(final.turn.message.providerState?.reasoning_content, "先看图片");
  assert.equal(final.turn.usage.inputTokens, 50);
  assert.ok(events.some((event) => event.type === "tool_call_delta"));
});

test("streaming JSON fallback returns complete structured tool calls", async () => {
  const events = [];
  for await (const event of streamAiModelTurn(endpoint, "mock", [{ role: "user", content: "read" }], {
    tools: [tool], fetchImpl: async () => turnResponse(null, [call]),
  })) events.push(event);
  assert.equal(events.length, 1);
  assert.equal(events[0].type, "complete");
});

test("incomplete, duplicate and unsupported calls never produce a completion event", async () => {
  const cases = [
    { tool_calls: [{ type: "function", function: { name: tool.name, arguments: "{}" } }] },
    { tool_calls: [1] },
    { tool_calls: [{ id: "x", type: "custom", function: { name: tool.name, arguments: "{}" } }] },
    { tool_calls: [call, call].map((value) => ({ id: value.id, type: "function", function: { name: value.name, arguments: value.arguments } })) },
  ];
  for (const message of cases) await assert.rejects(createAiModelTurn(endpoint, "mock", [], {
    tools: [tool], fetchImpl: async () => Response.json({ choices: [{ message }] }),
  }), (error) => error instanceof AiServiceError && error.kind === "invalid-response");
  let completed = false;
  await assert.rejects(async () => {
    for await (const event of streamAiModelTurn(endpoint, "mock", [], { tools: [tool], fetchImpl: async () => sseResponse([
      { choices: [{ delta: { tool_calls: [{ index: 0, id: "a", type: "function", function: { name: tool.name, arguments: '{"imageId":' } }] } }] },
    ], { done: false }) })) completed ||= event.type === "complete";
  });
  assert.equal(completed, false);
});

test("legacy text requests omit every tool option and preserve normalization and stream event shape", async () => {
  const bodies: Record<string, unknown>[] = [];
  const fetchImpl: typeof fetch = async (_url, init) => { bodies.push(JSON.parse(String(init?.body))); return turnResponse("  ```text\n正文\n```  "); };
  assert.equal(await createAiChatCompletion(endpoint, "mock", [{ role: "user", content: "read" }], { fetchImpl }), "正文");
  const events = [];
  for await (const event of streamAiChatCompletionEvents(endpoint, "mock", [{ role: "user", content: "read" }], { fetchImpl })) events.push(event);
  assert.deepEqual(events, [{ type: "content", text: "正文" }]);
  for (const body of bodies) for (const key of ["tools", "tool_choice", "parallel_tool_calls"]) assert.equal(key in body, false);
});

test("unsupported tool errors are explicit and do not return credentials or upstream bodies", async () => {
  await assert.rejects(createAiModelTurn(endpoint, "mock", [], { tools: [tool], fetchImpl: async () =>
    Response.json({ error: { message: "tools are not supported; private-test-key" } }, { status: 400 }) }),
    (error) => error instanceof AiServiceError && error.kind === "unsupported-tools" && !error.message.includes(endpoint.apiKey));
});

test("legacy SSE preserves whitespace deltas while JSON fallback rejects normalized-empty answers", async () => {
  const events = [];
  for await (const event of streamAiChatCompletionEvents(endpoint, "mock", [], { fetchImpl: async () => sseResponse([
    { choices: [{ delta: { content: "  \n" }, finish_reason: "stop" }] },
  ]) })) events.push(event);
  assert.deepEqual(events, [{ type: "content", text: "  \n" }]);
  await assert.rejects(async () => {
    for await (const event of streamAiChatCompletionEvents(endpoint, "mock", [], { fetchImpl: async () => turnResponse("  ") })) void event;
  }, /empty response/);
});
