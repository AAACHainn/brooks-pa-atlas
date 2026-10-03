import assert from "node:assert/strict";
import test from "node:test";

import {
  AiServiceError,
  createAiChatCompletion,
  createAiEmbeddings,
  fetchAiModels,
  streamAiChatCompletion,
  streamAiChatCompletionEvents,
} from "@/lib/ai-client";
import { buildOcrRefinementMessages } from "@/lib/ai-ocr-refinement";
import type { StoredAiEndpoint, StoredEmbeddingEndpoint } from "@/lib/ai-config";

function endpoint(apiKey = "secret"): StoredAiEndpoint {
  return {
    id: "endpoint-1",
    name: "Test",
    provider: "custom",
    baseUrl: "https://example.test/v1",
    useCustomUrls: false,
    chatCompletionsUrl: "",
    modelsUrl: "",
    apiKey,
    models: ["vision-model"],
    defaultModel: "vision-model",
  };
}

function embeddingEndpoint(apiKey = "secret"): StoredEmbeddingEndpoint {
  return {
    id: "embedding-1", name: "Embedding", provider: "custom", baseUrl: "https://example.test/v1",
    useCustomUrls: false, embeddingsUrl: "", modelsUrl: "", apiKey,
    models: ["embedding-model"], embeddingModel: "embedding-model",
  };
}

test("model discovery sends optional bearer auth and parses unique model ids", async () => {
  let headers: Headers | null = null;
  const models = await fetchAiModels(endpoint(), {
    fetchImpl: async (_input, init) => {
      headers = new Headers(init?.headers);
      return Response.json({ data: [{ id: "b" }, { id: "a" }, { id: "a" }, {}] });
    },
  });
  assert.deepEqual(models, ["a", "b"]);
  assert.equal(headers!.get("Authorization"), "Bearer secret");

  let anonymousHeaders: Headers | null = null;
  await fetchAiModels(endpoint(""), {
    fetchImpl: async (_input, init) => {
      anonymousHeaders = new Headers(init?.headers);
      return Response.json({ data: [] });
    },
  });
  assert.equal(anonymousHeaders!.has("Authorization"), false);
});

test("deep final streaming passes provider-specific output limits", async () => {
  for (const provider of ["custom", "openai"] as const) {
    let body: Record<string, unknown> = {};
    const events = [];
    for await (const event of streamAiChatCompletionEvents({ ...endpoint(), provider }, "vision", [{ role: "user", content: "answer" }], {
      maxOutputTokens: 8_192,
      fetchImpl: async (_url, init) => { body = JSON.parse(String(init?.body)); return Response.json({ choices: [{ message: { content: "answer" } }] }); },
    })) events.push(event);
    assert.equal(body[provider === "openai" ? "max_completion_tokens" : "max_tokens"], 8_192);
    assert.equal(events[0].text, "answer");
  }
});

test("cancellation propagates to structured chat and embedding requests", async () => {
  for (const kind of ["chat", "embedding"] as const) {
    const controller = new AbortController();
    let cancelled = false;
    const fetchImpl: typeof fetch = async (_url, init) => new Promise((_resolve, reject) => {
      init!.signal!.addEventListener("abort", () => { cancelled = true; reject(new DOMException("Aborted", "AbortError")); }, { once: true });
      queueMicrotask(() => controller.abort());
    });
    const promise = kind === "chat"
      ? createAiChatCompletion(endpoint(), "vision", [{ role: "user", content: "plan" }], { signal: controller.signal, fetchImpl })
      : createAiEmbeddings(embeddingEndpoint(), "embedding", ["question"], { signal: controller.signal, fetchImpl });
    await assert.rejects(promise);
    assert.equal(cancelled, true);
  }
});

test("embedding requests use float encoding and preserve response index order", async () => {
  let encodingFormat = "";
  const vectors = await createAiEmbeddings(embeddingEndpoint(), "embedding-model", ["a", "b"], {
    fetchImpl: async (_input, init) => {
      encodingFormat = String((JSON.parse(String(init?.body)) as Record<string, unknown>).encoding_format);
      return Response.json({ data: [
        { index: 1, embedding: [3, 4] },
        { index: 0, embedding: [1, 2] },
      ] });
    },
  });
  assert.deepEqual(vectors, [[1, 2], [3, 4]]);
  assert.equal(encodingFormat, "float");
});

test("chat completion sends multimodal messages and extracts fenced text", async () => {
  let body: unknown;
  const messages = buildOcrRefinementMessages({
    prompt: "Proofread",
    originalName: "chart.png",
    ocrText: "Br0oks",
    imageDataUrl: "data:image/jpeg;base64,AA==",
  });
  const text = await createAiChatCompletion(endpoint(), "vision-model", messages, {
    fetchImpl: async (_input, init) => {
      body = JSON.parse(String(init?.body));
      return Response.json({ choices: [{ message: { content: "```text\nBrooks\n```" } }] });
    },
  });
  assert.equal(text, "Brooks");
  assert.deepEqual((body as { messages: unknown }).messages, messages);
  assert.equal((body as { stream: boolean }).stream, false);
});

test("structured chat applies output limits, JSON mode, and reports usage", async () => {
  let requestBody: Record<string, unknown> = {};
  let usage: { inputTokens: number | null; outputTokens: number | null; reasoningTokens: number | null } | null = null;
  let finishReason: string | null = null;
  const text = await createAiChatCompletion(endpoint(), "plain-chat", [{ role: "user", content: "segment" }], {
    maxOutputTokens: 4096,
    temperature: 0,
    jsonMode: true,
    disableReasoning: true,
    onUsage: (value) => { usage = value; },
    onFinishReason: (value) => { finishReason = value; },
    fetchImpl: async (_input, init) => {
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return Response.json({ choices: [{ message: { content: "{\"segments\":[]}" }, finish_reason: "length" }], usage: { prompt_tokens: 10, completion_tokens: 4 } });
    },
  });
  assert.equal(text, '{"segments":[]}');
  assert.equal(requestBody.max_tokens, 4096);
  assert.equal(requestBody.temperature, 0);
  assert.deepEqual(requestBody.response_format, { type: "json_object" });
  assert.deepEqual(usage, { inputTokens: 10, outputTokens: 4, reasoningTokens: null });
  assert.equal(finishReason, "length");
});

test("DeepSeek subtitle requests explicitly disable thinking", async () => {
  let requestBody: Record<string, unknown> = {};
  let reasoningDetected = false;
  await createAiChatCompletion({ ...endpoint(), provider: "deepseek", baseUrl: "https://api.deepseek.com" }, "deepseek-chat", [{ role: "user", content: "segment" }], {
    disableReasoning: true,
    onReasoningDetected: (detected) => { reasoningDetected = detected; },
    fetchImpl: async (_input, init) => {
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return Response.json({ choices: [{ message: { content: "{}", reasoning_content: "unexpected" }, finish_reason: "stop" }] });
    },
  });
  assert.deepEqual(requestBody.thinking, { type: "disabled" });
  assert.equal(reasoningDetected, true);
});

test("OpenAI output limits use max_completion_tokens", async () => {
  let requestBody: Record<string, unknown> = {};
  await createAiChatCompletion({ ...endpoint(), provider: "openai" }, "gpt-5.1", [{ role: "user", content: "segment" }], {
    maxOutputTokens: 2_000,
    disableReasoning: true,
    fetchImpl: async (_input, init) => {
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return Response.json({ choices: [{ message: { content: "{}" }, finish_reason: "stop" }] });
    },
  });
  assert.equal(requestBody.max_completion_tokens, 2_000);
  assert.equal("max_tokens" in requestBody, false);
});

test("chat completion accepts array content and rejects empty responses", async () => {
  const text = await createAiChatCompletion(
    endpoint(),
    "vision-model",
    [{ role: "user", content: "test" }],
    {
      fetchImpl: async () =>
        Response.json({ choices: [{ message: { content: [{ type: "text", text: "OK" }] } }] }),
    },
  );
  assert.equal(text, "OK");

  await assert.rejects(
    createAiChatCompletion(endpoint(), "vision-model", [{ role: "user", content: "test" }], {
      fetchImpl: async () => Response.json({ choices: [{ message: { content: "" } }] }),
    }),
    (error: unknown) => error instanceof AiServiceError && error.kind === "invalid-response",
  );
});

test("upstream errors do not expose response bodies or API keys", async () => {
  await assert.rejects(
    fetchAiModels(endpoint("top-secret"), {
      fetchImpl: async () => new Response("provider leaked details", { status: 401, statusText: "Unauthorized" }),
    }),
    (error: unknown) => {
      assert.ok(error instanceof AiServiceError);
      assert.equal(error.kind, "upstream");
      assert.match(error.message, /401 Unauthorized/);
      assert.doesNotMatch(error.message, /provider leaked details|top-secret/);
      return true;
    },
  );
});

test("structured upstream errors retain a safe diagnostic summary", async () => {
  await assert.rejects(
    createAiEmbeddings(embeddingEndpoint("top-secret"), "embedding-model", ["a"], {
      fetchImpl: async () => Response.json({
        error: {
          code: "invalid_parameter",
          message: "input must contain at most 20 items; credential sk-private-token-123456",
        },
      }, { status: 400, statusText: "Bad Request" }),
    }),
    (error: unknown) => {
      assert.ok(error instanceof AiServiceError);
      assert.match(error.message, /invalid_parameter/);
      assert.match(error.message, /at most 20 items/);
      assert.doesNotMatch(error.message, /sk-private|top-secret/);
      return true;
    },
  );
});

test("multimodal requests report unsupported image input without exposing the provider body", async () => {
  const providerBody = JSON.stringify({
    error: { message: "This text-only model does not support image_url. trace=private-detail" },
  });
  await assert.rejects(
    createAiChatCompletion(
      endpoint("top-secret"),
      "text-only-model",
      buildOcrRefinementMessages({
        prompt: "Proofread",
        originalName: "chart.png",
        ocrText: "Br0oks",
        imageDataUrl: "data:image/jpeg;base64,AA==",
      }),
      {
        fetchImpl: async () =>
          new Response(providerBody, { status: 400, statusText: "Bad Request" }),
      },
    ),
    (error: unknown) => {
      assert.ok(error instanceof AiServiceError);
      assert.equal(error.kind, "unsupported-image");
      assert.match(error.message, /does not support image input/i);
      assert.doesNotMatch(error.message, /private-detail|top-secret/);
      return true;
    },
  );
});

test("requests enforce the configured timeout", async () => {
  await assert.rejects(
    fetchAiModels(endpoint(), {
      timeoutMs: 5,
      fetchImpl: async (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"));
          });
        }),
    }),
    (error: unknown) => error instanceof AiServiceError && error.kind === "timeout",
  );
});

test("streaming chat parses SSE split across chunks", async () => {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"Hel'));
      controller.enqueue(encoder.encode('lo"}}]}\n\ndata: {"choices":[{"delta":{"content":" 世界"}}]}\n'));
      controller.enqueue(encoder.encode("\ndata: [DONE]\n\n"));
      controller.close();
    },
  });
  const chunks: string[] = [];
  for await (const chunk of streamAiChatCompletion(
    endpoint(),
    "vision-model",
    [{ role: "user", content: "test" }],
    {
      fetchImpl: async () =>
        new Response(stream, { headers: { "Content-Type": "text/event-stream" } }),
    },
  )) {
    chunks.push(chunk);
  }
  assert.deepEqual(chunks, ["Hello", " 世界"]);
});

test("streaming chat accepts providers that return normal JSON", async () => {
  const chunks: string[] = [];
  for await (const chunk of streamAiChatCompletion(
    endpoint(),
    "vision-model",
    [{ role: "user", content: "test" }],
    {
      fetchImpl: async () => Response.json({ choices: [{ message: { content: "Complete" } }] }),
    },
  )) {
    chunks.push(chunk);
  }
  assert.deepEqual(chunks, ["Complete"]);
});

test("streaming chat exposes provider reasoning separately from answer content", async () => {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"reasoning_content":"Inspect chart"}}]}\n\n'));
      controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"reasoning_content":" carefully"}}]}\n\n'));
      controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"Final answer"}}]}\n\n'));
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
  const events = [];
  for await (const event of streamAiChatCompletionEvents(
    endpoint(),
    "reasoning-model",
    [{ role: "user", content: "test" }],
    {
      fetchImpl: async () =>
        new Response(stream, { headers: { "Content-Type": "text/event-stream" } }),
    },
  )) {
    events.push(event);
  }
  assert.deepEqual(events, [
    { type: "reasoning", text: "Inspect chart" },
    { type: "reasoning", text: " carefully" },
    { type: "content", text: "Final answer" },
  ]);
});

test("normal JSON fallback exposes reasoning content", async () => {
  const events = [];
  for await (const event of streamAiChatCompletionEvents(
    endpoint(),
    "reasoning-model",
    [{ role: "user", content: "test" }],
    {
      fetchImpl: async () => Response.json({
        choices: [{ message: { reasoning_content: "Reason", content: "Answer" } }],
      }),
    },
  )) {
    events.push(event);
  }
  assert.deepEqual(events, [
    { type: "reasoning", text: "Reason" },
    { type: "content", text: "Answer" },
  ]);
});
