import {
  type StoredEmbeddingEndpoint,
  type StoredAiEndpoint,
  resolveAiEndpointUrls,
  resolveEmbeddingEndpointUrls,
} from "@/lib/ai-config";
import type {
  ChatMessage, AiAssistantMessage, AiChatUsage, AiFunctionCall, AiFunctionDefinition,
  AiModelMessage, AiModelStreamEvent, AiModelTurn, AiToolChoice,
} from "@/lib/ai-model-types";
export type {
  ChatMessage, AiAssistantMessage, AiChatUsage, AiFunctionCall, AiFunctionDefinition,
  AiModelMessage, AiModelStreamEvent, AiModelTurn, AiToolChoice,
} from "@/lib/ai-model-types";

export type AiFetch = typeof fetch;

export class AiServiceError extends Error {
  readonly kind:
    | "configuration"
    | "timeout"
    | "upstream"
    | "invalid-response"
    | "unsupported-image"
    | "unsupported-tools";
  readonly upstreamStatus?: number;

  constructor(
    kind: AiServiceError["kind"],
    message: string,
    options?: { upstreamStatus?: number; cause?: unknown },
  ) {
    super(message, options?.cause ? { cause: options.cause } : undefined);
    this.name = "AiServiceError";
    this.kind = kind;
    this.upstreamStatus = options?.upstreamStatus;
  }
}

function requestHeaders(apiKey: string) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (apiKey.trim()) headers.Authorization = `Bearer ${apiKey.trim()}`;
  return headers;
}

function translateRequestError(error: unknown, controller: AbortController) {
  if (error instanceof AiServiceError) return error;
  if (
    controller.signal.aborted ||
    (error instanceof Error && error.name === "AbortError")
  ) {
    return new AiServiceError("timeout", "AI service request timed out.", { cause: error });
  }
  return new AiServiceError("upstream", "Could not reach the AI service.", { cause: error });
}

async function fetchJson(
  url: string,
  init: RequestInit,
  options: { fetchImpl?: AiFetch; timeoutMs?: number; visionRequest?: boolean; toolRequest?: boolean; signal?: AbortSignal } = {},
) {
  const controller = new AbortController();
  options.signal?.throwIfAborted();
  const abortFromCaller = () => controller.abort();
  options.signal?.addEventListener("abort", abortFromCaller, { once: true });
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 120_000);
  try {
    const response = await (options.fetchImpl ?? fetch)(url, {
      ...init,
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) {
      if (options.toolRequest && await isUnsupportedToolResponse(response.clone())) {
        throw new AiServiceError("unsupported-tools", "The selected endpoint or model does not support function tools.", { upstreamStatus: response.status });
      }
      if (options.visionRequest && (await isUnsupportedImageResponse(response.clone()))) {
        throw new AiServiceError(
          "unsupported-image",
          "The selected AI model does not support image input. Choose a vision-capable model.",
          { upstreamStatus: response.status },
        );
      }
      const detail = await readUpstreamErrorDetail(response);
      throw new AiServiceError(
        "upstream",
        `AI service returned ${response.status}${response.statusText ? ` ${response.statusText}` : ""}${detail ? `: ${detail}` : ""}.`,
        { upstreamStatus: response.status },
      );
    }
    try {
      return (await response.json()) as unknown;
    } catch (error) {
      throw new AiServiceError("invalid-response", "AI service returned invalid JSON.", {
        cause: error,
      });
    }
  } catch (error) {
    if (error instanceof AiServiceError) throw error;
    if (
      controller.signal.aborted ||
      (error instanceof Error && error.name === "AbortError")
    ) {
      throw new AiServiceError("timeout", "AI service request timed out.", { cause: error });
    }
    throw new AiServiceError("upstream", "Could not reach the AI service.", { cause: error });
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener("abort", abortFromCaller);
  }
}

async function readUpstreamErrorDetail(response: Response) {
  try {
    const raw = (await response.text()).slice(0, 16_384);
    let detail = "";
    try {
      const payload = JSON.parse(raw) as Record<string, unknown>;
      const error = typeof payload.error === "object" && payload.error !== null
        ? payload.error as Record<string, unknown>
        : null;
      const message = error?.message ?? payload.message;
      const code = error?.code ?? payload.code;
      detail = [code, message].filter((value) => typeof value === "string" && value.trim()).join(" · ");
    } catch {
      return "";
    }
    return detail
      .replace(/\b(?:sk|ak)-[A-Za-z0-9_-]{8,}\b/gi, "[redacted]")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 500);
  } catch {
    return "";
  }
}

async function isUnsupportedImageResponse(response: Response) {
  let message = "";
  try {
    message = (await response.text()).slice(0, 16_384).toLocaleLowerCase();
  } catch {
    return false;
  }
  const mentionsImage = /\b(image|images|vision|multimodal|image_url)\b/.test(message);
  const saysUnsupported =
    /\b(unsupported|not supported|does not support|text[- ]only|cannot (?:process|accept)|invalid content type)\b/.test(
      message,
    );
  const chineseUnsupported =
    /(?:不支持|无法处理|无法接收).{0,16}(?:图片|图像|视觉)/.test(message) ||
    /(?:图片|图像|视觉).{0,16}(?:不支持|无法处理|无法接收)/.test(message);
  return (mentionsImage && saysUnsupported) || chineseUnsupported;
}

async function isUnsupportedToolResponse(response: Response) {
  if (![400, 404, 422, 501].includes(response.status)) return false;
  const raw = (await response.text().catch(() => "")).slice(0, 16_384).toLowerCase();
  return /\b(tools|tool_choice|tool calling|function calling|function_call)\b/.test(raw)
    && /not supported|unsupported|does not support|unknown parameter|unrecognized|不支持/.test(raw);
}

export async function fetchAiModels(
  endpoint: StoredAiEndpoint | StoredEmbeddingEndpoint,
  options: { fetchImpl?: AiFetch; timeoutMs?: number } = {},
) {
  const { modelsUrl } = "chatCompletionsUrl" in endpoint
    ? resolveAiEndpointUrls(endpoint)
    : resolveEmbeddingEndpointUrls(endpoint);
  if (!modelsUrl) {
    throw new AiServiceError(
      "configuration",
      "A Models URL is required to fetch models for this endpoint.",
    );
  }
  const payload = await fetchJson(
    modelsUrl,
    { method: "GET", headers: requestHeaders(endpoint.apiKey) },
    options,
  );
  const data =
    typeof payload === "object" && payload !== null && "data" in payload
      ? (payload as { data?: unknown }).data
      : null;
  if (!Array.isArray(data)) {
    throw new AiServiceError("invalid-response", "AI service returned an invalid model list.");
  }
  return [
    ...new Set(
      data
        .map((item) =>
          typeof item === "object" && item !== null && "id" in item
            ? String((item as { id: unknown }).id).trim()
            : "",
        )
        .filter(Boolean),
    ),
  ].sort((left, right) => left.localeCompare(right));
}

export async function createAiEmbeddings(
  endpoint: StoredEmbeddingEndpoint,
  model: string,
  input: string[],
  options: { fetchImpl?: AiFetch; timeoutMs?: number; signal?: AbortSignal } = {},
) {
  if (!model.trim()) {
    throw new AiServiceError("configuration", "An embedding model is required.");
  }
  if (input.length === 0) return [];
  const { embeddingsUrl } = resolveEmbeddingEndpointUrls(endpoint);
  if (!embeddingsUrl) {
    throw new AiServiceError("configuration", "An Embeddings URL is required.");
  }
  const payload = await fetchJson(
    embeddingsUrl,
    {
      method: "POST",
      headers: requestHeaders(endpoint.apiKey),
      body: JSON.stringify({ model: model.trim(), input, encoding_format: "float" }),
    },
    options,
  );
  const data =
    typeof payload === "object" && payload !== null && "data" in payload
      ? (payload as { data?: unknown }).data
      : null;
  if (!Array.isArray(data)) {
    throw new AiServiceError("invalid-response", "AI service returned invalid embeddings.");
  }
  const vectors = data
    .map((item, fallbackIndex) => {
      if (typeof item !== "object" || item === null) return null;
      const record = item as Record<string, unknown>;
      if (!Array.isArray(record.embedding)) return null;
      const embedding = record.embedding.map(Number);
      if (embedding.length === 0 || embedding.some((value) => !Number.isFinite(value))) return null;
      return {
        index: Number.isInteger(record.index) ? Number(record.index) : fallbackIndex,
        embedding,
      };
    })
    .filter((item): item is { index: number; embedding: number[] } => item !== null)
    .sort((left, right) => left.index - right.index);
  if (vectors.length !== input.length) {
    throw new AiServiceError("invalid-response", "AI service returned the wrong number of embeddings.");
  }
  const dimension = vectors[0]?.embedding.length ?? 0;
  if (!dimension || vectors.some((item) => item.embedding.length !== dimension)) {
    throw new AiServiceError("invalid-response", "AI service returned inconsistent embedding dimensions.");
  }
  return vectors.map((item) => item.embedding);
}

export async function testAiEmbeddingConnection(
  endpoint: StoredEmbeddingEndpoint,
  model: string,
  options: { fetchImpl?: AiFetch; timeoutMs?: number } = {},
) {
  const [embedding] = await createAiEmbeddings(endpoint, model, ["embedding connection test"], options);
  return { dimension: embedding.length };
}

function firstChoiceContainer(payload: unknown, field: "message" | "delta") {
  if (typeof payload !== "object" || payload === null || !("choices" in payload)) return null;
  const choices = (payload as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const choice = choices[0];
  if (typeof choice !== "object" || choice === null || !(field in choice)) return null;
  const container = (choice as Record<string, unknown>)[field];
  return typeof container === "object" && container !== null
    ? (container as Record<string, unknown>)
    : null;
}

function arrayContentText(content: unknown, reasoning: boolean) {
  if (!Array.isArray(content)) return "";
  return content
    .map((part) =>
      typeof part === "object" && part !== null
        ? (() => {
            const record = part as Record<string, unknown>;
            const type = typeof record.type === "string" ? record.type.toLowerCase() : "";
            const isReasoning = type.includes("reason") || type.includes("think");
            if (isReasoning !== reasoning) return "";
            if (typeof record.text === "string") return record.text;
            if (typeof record.content === "string") return record.content;
            return "";
          })()
        : "",
    )
    .join("");
}

function answerText(container: Record<string, unknown> | null) {
  if (!container) return "";
  if (typeof container.content === "string") return container.content;
  return arrayContentText(container.content, false);
}

function reasoningText(container: Record<string, unknown> | null) {
  if (!container) return "";
  const directFields = ["reasoning_content", "reasoning", "thinking"] as const;
  for (const field of directFields) {
    const value = container[field];
    if (typeof value === "string") return value;
    if (typeof value === "object" && value !== null) {
      const record = value as Record<string, unknown>;
      if (typeof record.text === "string") return record.text;
      if (typeof record.content === "string") return record.content;
    }
  }
  const details = container.reasoning_details;
  if (Array.isArray(details)) {
    const text = details
      .map((detail) => {
        if (typeof detail !== "object" || detail === null) return "";
        const record = detail as Record<string, unknown>;
        if (typeof record.text === "string") return record.text;
        if (typeof record.content === "string") return record.content;
        return "";
      })
      .join("");
    if (text) return text;
  }
  return arrayContentText(container.content, true);
}

function extractResponseParts(payload: unknown, field: "message" | "delta") {
  const container = firstChoiceContainer(payload, field);
  return { content: answerText(container), reasoning: reasoningText(container) };
}

export function normalizeAiText(value: string) {
  const trimmed = value.trim();
  const fenced = trimmed.match(/^```(?:text|txt|markdown)?\s*\n([\s\S]*?)\n```$/i);
  return (fenced?.[1] ?? trimmed).trim();
}

type AiChatCompletionOptions = {
  fetchImpl?: AiFetch;
  timeoutMs?: number;
  maxOutputTokens?: number;
  temperature?: number;
  jsonMode?: boolean;
  disableReasoning?: boolean;
  signal?: AbortSignal;
  onUsage?: (usage: AiChatUsage) => void | Promise<void>;
  onFinishReason?: (reason: string | null) => void | Promise<void>;
  onReasoningDetected?: (detected: boolean) => void | Promise<void>;
};

export type AiModelRequestOptions = AiChatCompletionOptions & {
  tools?: readonly AiFunctionDefinition[];
  toolChoice?: AiToolChoice;
};

function chatUsage(payload: unknown): AiChatUsage {
  const usage = typeof payload === "object" && payload !== null && "usage" in payload
    && typeof (payload as { usage?: unknown }).usage === "object"
    && (payload as { usage?: unknown }).usage !== null
    ? (payload as { usage: Record<string, unknown> }).usage
    : null;
  const details = usage && typeof usage.completion_tokens_details === "object" && usage.completion_tokens_details !== null
    ? usage.completion_tokens_details as Record<string, unknown>
    : null;
  const numberOrNull = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : null;
  return {
    inputTokens: numberOrNull(usage?.prompt_tokens ?? usage?.input_tokens),
    outputTokens: numberOrNull(usage?.completion_tokens ?? usage?.output_tokens),
    reasoningTokens: numberOrNull(details?.reasoning_tokens),
  };
}

function reasoningControl(endpoint: StoredAiEndpoint, model: string, disabled: boolean | undefined) {
  if (!disabled) return {};
  const chatUrl = resolveAiEndpointUrls(endpoint).chatCompletionsUrl;
  if (new URL(chatUrl).hostname.toLowerCase() === "api.xiaomimimo.com") {
    return { thinking: { type: "disabled" } };
  }
  const identity = `${endpoint.baseUrl} ${endpoint.chatCompletionsUrl} ${model}`.toLowerCase();
  if (/qwen|dashscope|aliyun|alibabacloud/.test(identity)) return { enable_thinking: false };
  if (endpoint.provider === "deepseek" || /deepseek/.test(identity)) {
    return { thinking: { type: "disabled" } };
  }
  if (endpoint.provider === "openai") return { reasoning_effort: "none" };
  if (/reasoner|reasoning|\br1\b/.test(model.toLowerCase())) {
    throw new AiServiceError("configuration", "字幕整理请选择非推理模型；当前端点无法可靠关闭该模型的推理输出。");
  }
  return {};
}

function chatFinishReason(payload: unknown) {
  if (typeof payload !== "object" || payload === null || !("choices" in payload)) return null;
  const choices = (payload as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || typeof choices[0] !== "object" || choices[0] === null) return null;
  const reason = (choices[0] as { finish_reason?: unknown }).finish_reason;
  return typeof reason === "string" && reason.trim() ? reason : null;
}

function outputTokenControl(endpoint: StoredAiEndpoint, maxOutputTokens: number | undefined) {
  if (!maxOutputTokens) return {};
  return endpoint.provider === "openai"
    ? { max_completion_tokens: maxOutputTokens }
    : { max_tokens: maxOutputTokens };
}

const reasoningFields = ["reasoning_content", "reasoning", "thinking", "reasoning_details"] as const;
const toolNamePattern = /^[A-Za-z0-9_-]{1,64}$/;

function serializeModelMessage(message: AiModelMessage) {
  if (message.role === "tool") return { role: "tool", tool_call_id: message.callId, content: message.content };
  if (message.role !== "assistant") return message;
  const assistant = message as AiAssistantMessage;
  const state = Object.fromEntries(reasoningFields.flatMap((key) =>
    assistant.providerState?.[key] !== undefined ? [[key, assistant.providerState[key]]] : []));
  return { role: "assistant", content: assistant.content, ...state,
    ...(assistant.toolCalls?.length ? { tool_calls: assistant.toolCalls.map((call) => ({
      id: call.id, type: "function", function: { name: call.name, arguments: call.arguments },
    })) } : {}) };
}

function chatRequestBody(endpoint: StoredAiEndpoint, model: string, messages: AiModelMessage[], stream: boolean, options: AiModelRequestOptions) {
  if (!model.trim()) throw new AiServiceError("configuration", "An AI model is required.");
  const tools = options.tools?.length ? options.tools : undefined;
  if (tools && (new Set(tools.map((tool) => tool.name)).size !== tools.length || tools.some((tool) => !toolNamePattern.test(tool.name)))) {
    throw new AiServiceError("configuration", "Function tool names must be unique and valid.");
  }
  const chosenName = typeof options.toolChoice === "object" ? options.toolChoice.name : undefined;
  if (chosenName && !tools?.some((tool) => tool.name === chosenName)) {
    throw new AiServiceError("configuration", "The selected function tool is not available.");
  }
  return {
    model: model.trim(), messages: messages.map(serializeModelMessage), stream,
    ...outputTokenControl(endpoint, options.maxOutputTokens),
    ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
    ...(options.jsonMode ? { response_format: { type: "json_object" } } : {}),
    ...reasoningControl(endpoint, model, options.disableReasoning),
    ...(tools ? { tools: tools.map((tool) => ({ type: "function", function: tool })),
      ...(options.toolChoice ? { tool_choice: typeof options.toolChoice === "string" ? options.toolChoice
        : { type: "function", function: { name: options.toolChoice.name } } } : {}) } : {}),
  };
}

function hasImages(messages: AiModelMessage[]) {
  return messages.some((message) => message.role === "user" && Array.isArray(message.content)
    && message.content.some((part) => part.type === "image_url"));
}

function checkedCalls(calls: AiFunctionCall[]) {
  const ids = new Set<string>();
  for (const call of calls) {
    if (!call.id.trim() || !toolNamePattern.test(call.name) || ids.has(call.id)) {
      throw new AiServiceError("invalid-response", "AI service returned invalid or duplicate function calls.");
    }
    ids.add(call.id);
  }
  return calls;
}

function parseCalls(container: Record<string, unknown> | null): AiFunctionCall[] {
  const raw = container?.tool_calls;
  if (raw == null) return [];
  if (!Array.isArray(raw) || raw.length > 64) throw new AiServiceError("invalid-response", "AI service returned invalid function calls.");
  return checkedCalls(raw.map((item) => {
    if (typeof item !== "object" || item === null) throw new AiServiceError("invalid-response", "AI service returned invalid function calls.");
    const call = item as Record<string, unknown>;
    const fn = call.function as Record<string, unknown> | undefined;
    if (call.type !== "function" || typeof call.id !== "string" || !fn || typeof fn.name !== "string" || typeof fn.arguments !== "string"
      || fn.arguments.length > 1_048_576) {
      throw new AiServiceError("invalid-response", "AI service returned an incomplete function call.");
    }
    return { id: call.id, name: fn.name, arguments: fn.arguments };
  }));
}

function providerState(container: Record<string, unknown> | null) {
  return Object.fromEntries(reasoningFields.flatMap((key) => container?.[key] !== undefined ? [[key, container[key]]] : []));
}

function parseTurn(payload: unknown): AiModelTurn {
  const container = firstChoiceContainer(payload, "message");
  const calls = parseCalls(container);
  const content = answerText(container);
  if (!content && !calls.length) throw new AiServiceError("invalid-response", "AI service returned an empty response.");
  return { message: { role: "assistant", content: content || null, ...(calls.length ? { toolCalls: calls } : {}),
    ...(Object.keys(providerState(container)).length ? { providerState: providerState(container) } : {}) },
    reasoning: reasoningText(container), finishReason: chatFinishReason(payload), usage: chatUsage(payload) };
}

export async function createAiModelTurn(endpoint: StoredAiEndpoint, model: string, messages: AiModelMessage[], options: AiModelRequestOptions = {}): Promise<AiModelTurn> {
  const body = chatRequestBody(endpoint, model, messages, false, options);
  const payload = await fetchJson(resolveAiEndpointUrls(endpoint).chatCompletionsUrl, {
    method: "POST", headers: requestHeaders(endpoint.apiKey), body: JSON.stringify(body),
  }, { ...options, visionRequest: hasImages(messages), toolRequest: Boolean(options.tools?.length) });
  await options.onUsage?.(chatUsage(payload));
  await options.onFinishReason?.(chatFinishReason(payload));
  const turn = parseTurn(payload);
  await options.onReasoningDetected?.(Boolean(turn.reasoning));
  return turn;
}

/** Shared streaming transport. No execution happens here, even for complete calls. */
export async function* streamAiModelTurn(endpoint: StoredAiEndpoint, model: string, messages: AiModelMessage[], options: AiModelRequestOptions = {}): AsyncGenerator<AiModelStreamEvent> {
  const body = chatRequestBody(endpoint, model, messages, true, options);
  const controller = new AbortController();
  options.signal?.throwIfAborted();
  const abortFromCaller = () => controller.abort();
  options.signal?.addEventListener("abort", abortFromCaller, { once: true });
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 120_000);
  try {
    const response = await (options.fetchImpl ?? fetch)(resolveAiEndpointUrls(endpoint).chatCompletionsUrl, {
      method: "POST", headers: requestHeaders(endpoint.apiKey), body: JSON.stringify(body), cache: "no-store", signal: controller.signal,
    });
    if (!response.ok) {
      if (options.tools?.length && await isUnsupportedToolResponse(response.clone())) {
        throw new AiServiceError("unsupported-tools", "The selected endpoint or model does not support function tools.", { upstreamStatus: response.status });
      }
      if (hasImages(messages) && await isUnsupportedImageResponse(response.clone())) {
        throw new AiServiceError("unsupported-image", "The selected AI model does not support image input. Choose a vision-capable model.", { upstreamStatus: response.status });
      }
      throw new AiServiceError("upstream", `AI service returned ${response.status}${response.statusText ? ` ${response.statusText}` : ""}.`, { upstreamStatus: response.status });
    }
    if (response.headers.get("content-type")?.toLowerCase().includes("application/json")) {
      let payload: unknown;
      try { payload = await response.json(); }
      catch { throw new AiServiceError("invalid-response", "AI service returned invalid JSON."); }
      controller.signal.throwIfAborted();
      const turn = parseTurn(payload);
      if (turn.reasoning) yield { type: "reasoning", text: turn.reasoning, source: "json" };
      if (turn.message.content) yield { type: "content", text: turn.message.content, source: "json" };
      await options.onUsage?.(turn.usage);
      await options.onFinishReason?.(turn.finishReason);
      await options.onReasoningDetected?.(Boolean(turn.reasoning));
      controller.signal.throwIfAborted();
      yield { type: "complete", turn, source: "json" };
      return;
    }
    if (!response.body) throw new AiServiceError("invalid-response", "AI service returned an empty response.");
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let pending = "", content = "", reasoning = "", finishReason: string | null = null;
    let usage: AiChatUsage = { inputTokens: null, outputTokens: null, reasoningTokens: null };
    const state: Record<string, unknown> = {};
    const calls = new Map<number, AiFunctionCall>();
    let completed = false;
    function consumeLine(rawLine: string): AiModelStreamEvent[] {
      const line = rawLine.trim();
      if (!line.startsWith("data:")) return [];
      const data = line.slice(5).trim();
      if (!data) return [];
      if (data === "[DONE]") { completed = true; return []; }
      let payload: unknown;
      try { payload = JSON.parse(data); }
      catch { throw new AiServiceError("invalid-response", "AI service returned invalid stream data."); }
      const container = firstChoiceContainer(payload, "delta");
      const parts = extractResponseParts(payload, "delta");
      const events: AiModelStreamEvent[] = [];
      const reason = chatFinishReason(payload);
      if (reason) finishReason = reason;
      const currentUsage = chatUsage(payload);
      if (Object.values(currentUsage).some((value) => value !== null)) usage = currentUsage;
      if (parts.reasoning) { reasoning += parts.reasoning; events.push({ type: "reasoning", text: parts.reasoning, source: "sse" }); }
      if (parts.content) { content += parts.content; events.push({ type: "content", text: parts.content, source: "sse" }); }
      for (const key of reasoningFields) {
        const value = container?.[key];
        if (typeof value === "string") state[key] = String(state[key] ?? "") + value;
        else if (Array.isArray(value)) state[key] = [...(Array.isArray(state[key]) ? state[key] : []), ...value];
        else if (typeof value === "object" && value !== null) {
          const prior = (state[key] ?? {}) as Record<string, unknown>;
          const next = { ...prior, ...value } as Record<string, unknown>;
          for (const field of ["text", "content"]) if (typeof (value as Record<string, unknown>)[field] === "string") {
            next[field] = String(prior[field] ?? "") + (value as Record<string, unknown>)[field];
          }
          state[key] = next;
        }
      }
      const deltas = container?.tool_calls;
      if (deltas != null) {
        if (!Array.isArray(deltas)) throw new AiServiceError("invalid-response", "AI service returned invalid function deltas.");
        for (const raw of deltas) {
          if (typeof raw !== "object" || raw === null) throw new AiServiceError("invalid-response", "AI service returned invalid function deltas.");
          const delta = raw as Record<string, unknown>;
          const index = delta.index;
          if (!Number.isInteger(index) || Number(index) < 0 || Number(index) >= 64 || (delta.type != null && delta.type !== "function")) {
            throw new AiServiceError("invalid-response", "AI service returned invalid function deltas.");
          }
          const call = calls.get(Number(index)) ?? { id: "", name: "", arguments: "" };
          const fn = delta.function as Record<string, unknown> | undefined;
          if (delta.function != null && (typeof delta.function !== "object" || Array.isArray(delta.function))) {
            throw new AiServiceError("invalid-response", "AI service returned invalid function deltas.");
          }
          if (delta.id != null && typeof delta.id !== "string" || fn?.name != null && typeof fn.name !== "string" || fn?.arguments != null && typeof fn.arguments !== "string") {
            throw new AiServiceError("invalid-response", "AI service returned invalid function deltas.");
          }
          if (typeof delta.id === "string") {
            if (call.id && call.id !== delta.id) throw new AiServiceError("invalid-response", "AI service changed a function call id.");
            call.id = delta.id;
          }
          if (typeof fn?.name === "string") call.name += fn.name;
          if (typeof fn?.arguments === "string") call.arguments += fn.arguments;
          if (call.arguments.length > 1_048_576) throw new AiServiceError("invalid-response", "Function arguments exceed the response limit.");
          calls.set(Number(index), call);
          events.push({ type: "tool_call_delta", index: Number(index),
            ...(typeof delta.id === "string" ? { id: delta.id } : {}),
            ...(typeof fn?.name === "string" ? { name: fn.name } : {}),
            ...(typeof fn?.arguments === "string" ? { arguments: fn.arguments } : {}) });
        }
      }
      return events;
    }
    while (!completed) {
      controller.signal.throwIfAborted();
      const { value, done } = await reader.read();
      pending += decoder.decode(value, { stream: !done });
      const lines = pending.split(/\r?\n/);
      pending = done ? "" : lines.pop() ?? "";
      for (const line of lines) {
        for (const event of consumeLine(line)) yield event;
        if (completed) break;
      }
      if (pending.length > 2_097_152) throw new AiServiceError("invalid-response", "AI service returned an oversized stream frame.");
      if (completed) { await reader.cancel(); break; }
      if (done) break;
    }
    controller.signal.throwIfAborted();
    if (!completed && !finishReason) throw new AiServiceError("invalid-response", "AI service stream ended before the answer completed.");
    const toolCalls = checkedCalls([...calls.entries()].sort(([a], [b]) => a - b).map(([, call]) => call));
    if (!content && !toolCalls.length) throw new AiServiceError("invalid-response", "AI service returned an empty response.");
    const turn: AiModelTurn = { message: { role: "assistant", content: content || null,
      ...(toolCalls.length ? { toolCalls } : {}), ...(Object.keys(state).length ? { providerState: state } : {}) }, reasoning, finishReason, usage };
    await options.onUsage?.(usage);
    await options.onFinishReason?.(finishReason);
    await options.onReasoningDetected?.(Boolean(reasoning));
    controller.signal.throwIfAborted();
    yield { type: "complete", turn, source: "sse" };
  } catch (error) { throw translateRequestError(error, controller); }
  finally { clearTimeout(timeout); options.signal?.removeEventListener("abort", abortFromCaller); controller.abort(); }
}

/** Existing text-only interfaces intentionally never opt into tools. */
export async function createAiChatCompletion(endpoint: StoredAiEndpoint, model: string, messages: ChatMessage[], options: AiChatCompletionOptions = {}) {
  const turn = await createAiModelTurn(endpoint, model, messages, options);
  const text = normalizeAiText(turn.message.content ?? "");
  if (!text || turn.message.toolCalls?.length) throw new AiServiceError("invalid-response", "AI service returned an empty response.");
  return text;
}
export type AiChatStreamEvent = { type: "content" | "reasoning"; text: string };
export async function* streamAiChatCompletionEvents(endpoint: StoredAiEndpoint, model: string, messages: ChatMessage[], options: { fetchImpl?: AiFetch; timeoutMs?: number; signal?: AbortSignal; maxOutputTokens?: number } = {}): AsyncGenerator<AiChatStreamEvent> {
  for await (const event of streamAiModelTurn(endpoint, model, messages, options)) {
    if (event.type === "content" || event.type === "reasoning") {
      const text = event.type === "content" && event.source === "json" ? normalizeAiText(event.text) : event.text;
      if (event.type === "content" && event.source === "json" && !text) throw new AiServiceError("invalid-response", "AI service returned an empty response.");
      yield { type: event.type, text };
    } else if (event.type === "complete" && event.turn.message.toolCalls?.length) {
      throw new AiServiceError("invalid-response", "AI service returned an unexpected function call.");
    }
  }
}
export async function* streamAiChatCompletion(endpoint: StoredAiEndpoint, model: string, messages: ChatMessage[], options: { fetchImpl?: AiFetch; timeoutMs?: number; signal?: AbortSignal } = {}) {
  for await (const event of streamAiChatCompletionEvents(endpoint, model, messages, options)) if (event.type === "content") yield event.text;
}
export async function testAiConnection(endpoint: StoredAiEndpoint, model: string, options: { fetchImpl?: AiFetch; timeoutMs?: number } = {}) {
  return createAiChatCompletion(endpoint, model, [{ role: "user", content: "Reply with OK." }], options);
}
