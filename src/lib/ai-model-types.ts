/** Provider-independent messages. Protocol serialization belongs to ai-client. */
export type ChatMessage =
  | { role: "system" | "assistant"; content: string }
  | { role: "user"; content: string | Array<
      { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }
    > };

export type AiFunctionCall = { id: string; name: string; arguments: string };
export type AiFunctionDefinition = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  strict?: boolean;
};
export type AiToolChoice = "auto" | "none" | "required" | { name: string };
export type AiAssistantMessage = {
  role: "assistant";
  content: string | null;
  toolCalls?: AiFunctionCall[];
  /** Only provider reasoning fields are retained; never exposed in execution traces. */
  providerState?: Record<string, unknown>;
};
export type AiModelMessage = ChatMessage | AiAssistantMessage
  | { role: "tool"; callId: string; content: string };
export type AiChatUsage = {
  inputTokens: number | null;
  outputTokens: number | null;
  reasoningTokens: number | null;
};
export type AiModelTurn = {
  message: AiAssistantMessage;
  reasoning: string;
  finishReason: string | null;
  usage: AiChatUsage;
};
export type AiModelStreamEvent =
  | { type: "content" | "reasoning"; text: string; source: "sse" | "json" }
  | { type: "tool_call_delta"; index: number; id?: string; name?: string; arguments?: string }
  | { type: "complete"; turn: AiModelTurn; source: "sse" | "json" };
