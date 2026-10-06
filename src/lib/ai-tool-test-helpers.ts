import { defaultStoredAiConfig } from "@/lib/ai-config";
import type { AiFunctionCall } from "@/lib/ai-model-types";

export function toolTestConfig() {
  const config = defaultStoredAiConfig();
  config.endpoints = [{ id: "mock", name: "Mock", provider: "custom", baseUrl: "https://example.test/v1",
    apiKey: "private-test-key", useCustomUrls: false, chatCompletionsUrl: "", modelsUrl: "", models: ["mock-model"], defaultModel: "mock-model" }];
  config.activeEndpointId = "mock";
  return config;
}
export function wireCall(call: AiFunctionCall) {
  return { id: call.id, type: "function", function: { name: call.name, arguments: call.arguments } };
}
export function turnResponse(content: string | null, calls: AiFunctionCall[] = [], extra: Record<string, unknown> = {}) {
  return Response.json({ choices: [{ message: { role: "assistant", content, ...(calls.length ? { tool_calls: calls.map(wireCall) } : {}) },
    finish_reason: calls.length ? "tool_calls" : "stop" }], ...extra });
}
export function sseResponse(payloads: unknown[], options: { done?: boolean; byteChunks?: number } = {}) {
  const encoded = new TextEncoder().encode(payloads.map((payload) => `data: ${JSON.stringify(payload)}\n\n`).join("")
    + (options.done === false ? "" : "data: [DONE]\n\n"));
  return new Response(new ReadableStream<Uint8Array>({ start(controller) {
    const chunk = options.byteChunks ?? 17;
    for (let index = 0; index < encoded.length; index += chunk) controller.enqueue(encoded.slice(index, index + chunk));
    controller.close();
  } }), { headers: { "Content-Type": "text/event-stream" } });
}
