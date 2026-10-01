import {
  type StoredEmbeddingEndpoint,
  type StoredAiEndpoint,
  resolveAiEndpointUrls,
  resolveEmbeddingEndpointUrls,
} from "@/lib/ai-config";

export type AiFetch = typeof fetch;

export class AiServiceError extends Error {
  readonly kind:
    | "configuration"
    | "timeout"
    | "upstream"
    | "invalid-response"
    | "unsupported-image";
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

export type ChatMessage =
  | { role: "system" | "assistant"; content: string }
  | {
      role: "user";
      content:
        | string
        | Array<
            | { type: "text"; text: string }
            | { type: "image_url"; image_url: { url: string } }
          >;
    };

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
  options: { fetchImpl?: AiFetch; timeoutMs?: number; visionRequest?: boolean } = {},
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 120_000);
  try {
    const response = await (options.fetchImpl ?? fetch)(url, {
      ...init,
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) {
      if (options.visionRequest && (await isUnsupportedImageResponse(response))) {
        throw new AiServiceError(
          "unsupported-image",
          "The selected AI model does not support image input. Choose a vision-capable model.",
          { upstreamStatus: response.status },
        );
      }
      throw new AiServiceError(
        "upstream",
        `AI service returned ${response.status}${response.statusText ? ` ${response.statusText}` : ""}.`,
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
  options: { fetchImpl?: AiFetch; timeoutMs?: number } = {},
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

function extractTextContent(payload: unknown) {
  return answerText(firstChoiceContainer(payload, "message"));
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

export async function createAiChatCompletion(
  endpoint: StoredAiEndpoint,
  model: string,
  messages: ChatMessage[],
  options: { fetchImpl?: AiFetch; timeoutMs?: number } = {},
) {
  if (!model.trim()) {
    throw new AiServiceError("configuration", "An AI model is required.");
  }
  const { chatCompletionsUrl } = resolveAiEndpointUrls(endpoint);
  const payload = await fetchJson(
    chatCompletionsUrl,
    {
      method: "POST",
      headers: requestHeaders(endpoint.apiKey),
      body: JSON.stringify({ model: model.trim(), messages, stream: false }),
    },
    {
      ...options,
      visionRequest: messages.some(
        (message) =>
          Array.isArray(message.content) &&
          message.content.some((part) => part.type === "image_url"),
      ),
    },
  );
  const text = normalizeAiText(extractTextContent(payload));
  if (!text) {
    throw new AiServiceError("invalid-response", "AI service returned an empty response.");
  }
  return text;
}

export type AiChatStreamEvent = {
  type: "content" | "reasoning";
  text: string;
};

export async function* streamAiChatCompletionEvents(
  endpoint: StoredAiEndpoint,
  model: string,
  messages: ChatMessage[],
  options: { fetchImpl?: AiFetch; timeoutMs?: number; signal?: AbortSignal } = {},
) {
  if (!model.trim()) {
    throw new AiServiceError("configuration", "An AI model is required.");
  }
  const { chatCompletionsUrl } = resolveAiEndpointUrls(endpoint);
  const controller = new AbortController();
  const abortFromCaller = () => controller.abort();
  options.signal?.addEventListener("abort", abortFromCaller, { once: true });
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 120_000);
  const visionRequest = messages.some(
    (message) =>
      Array.isArray(message.content) &&
      message.content.some((part) => part.type === "image_url"),
  );
  let emittedContent = false;

  try {
    const response = await (options.fetchImpl ?? fetch)(chatCompletionsUrl, {
      method: "POST",
      headers: requestHeaders(endpoint.apiKey),
      body: JSON.stringify({ model: model.trim(), messages, stream: true }),
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) {
      if (visionRequest && (await isUnsupportedImageResponse(response))) {
        throw new AiServiceError(
          "unsupported-image",
          "The selected AI model does not support image input. Choose a vision-capable model.",
          { upstreamStatus: response.status },
        );
      }
      throw new AiServiceError(
        "upstream",
        `AI service returned ${response.status}${response.statusText ? ` ${response.statusText}` : ""}.`,
        { upstreamStatus: response.status },
      );
    }

    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    if (contentType.includes("application/json")) {
      let payload: unknown;
      try {
        payload = await response.json();
      } catch (error) {
        throw new AiServiceError("invalid-response", "AI service returned invalid JSON.", {
          cause: error,
        });
      }
      const parts = extractResponseParts(payload, "message");
      const text = normalizeAiText(parts.content);
      if (!text) {
        throw new AiServiceError("invalid-response", "AI service returned an empty response.");
      }
      if (parts.reasoning) yield { type: "reasoning", text: parts.reasoning };
      emittedContent = true;
      yield { type: "content", text };
      return;
    }

    if (!response.body) {
      throw new AiServiceError("invalid-response", "AI service returned an empty response.");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let pending = "";

    function consumeLines(lines: string[]) {
      const events: AiChatStreamEvent[] = [];
      let finished = false;
      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line || line.startsWith(":")) continue;
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (!data) continue;
        if (data === "[DONE]") {
          finished = true;
          break;
        }
        let payload: unknown;
        try {
          payload = JSON.parse(data);
        } catch (error) {
          throw new AiServiceError("invalid-response", "AI service returned invalid stream data.", {
            cause: error,
          });
        }
        const parts = extractResponseParts(payload, "delta");
        if (parts.reasoning) events.push({ type: "reasoning", text: parts.reasoning });
        if (parts.content) events.push({ type: "content", text: parts.content });
      }
      return { events, finished };
    }

    let finished = false;
    while (true) {
      const { value, done } = await reader.read();
      pending += decoder.decode(value, { stream: !done });
      const lines = pending.split(/\r?\n/);
      pending = done ? "" : (lines.pop() ?? "");
      const parsedLines = consumeLines(lines);
      for (const event of parsedLines.events) {
        if (event.type === "content") emittedContent = true;
        yield event;
      }
      if (parsedLines.finished) {
        finished = true;
        await reader.cancel();
        break;
      }
      if (done) break;
    }
    if (!finished && pending.trim()) {
      for (const event of consumeLines([pending]).events) {
        if (event.type === "content") emittedContent = true;
        yield event;
      }
    }
    if (!emittedContent) {
      throw new AiServiceError("invalid-response", "AI service returned an empty response.");
    }
  } catch (error) {
    throw translateRequestError(error, controller);
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener("abort", abortFromCaller);
  }
}

export async function* streamAiChatCompletion(
  endpoint: StoredAiEndpoint,
  model: string,
  messages: ChatMessage[],
  options: { fetchImpl?: AiFetch; timeoutMs?: number; signal?: AbortSignal } = {},
) {
  for await (const event of streamAiChatCompletionEvents(endpoint, model, messages, options)) {
    if (event.type === "content") yield event.text;
  }
}

export async function testAiConnection(
  endpoint: StoredAiEndpoint,
  model: string,
  options: { fetchImpl?: AiFetch; timeoutMs?: number } = {},
) {
  return createAiChatCompletion(
    endpoint,
    model,
    [{ role: "user", content: "Reply with OK." }],
    options,
  );
}
