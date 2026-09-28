import {
  type StoredAiEndpoint,
  resolveAiEndpointUrls,
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

type ChatMessage =
  | { role: "system"; content: string }
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
  endpoint: StoredAiEndpoint,
  options: { fetchImpl?: AiFetch; timeoutMs?: number } = {},
) {
  const { modelsUrl } = resolveAiEndpointUrls(endpoint);
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

function extractTextContent(payload: unknown) {
  if (typeof payload !== "object" || payload === null || !("choices" in payload)) return "";
  const choices = (payload as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) return "";
  const message =
    typeof choices[0] === "object" && choices[0] !== null && "message" in choices[0]
      ? (choices[0] as { message?: unknown }).message
      : null;
  const content =
    typeof message === "object" && message !== null && "content" in message
      ? (message as { content?: unknown }).content
      : null;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) =>
      typeof part === "object" && part !== null && "text" in part
        ? String((part as { text: unknown }).text)
        : "",
    )
    .join("");
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
