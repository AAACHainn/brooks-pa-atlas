/** Shared, client-safe defaults and sanitized budget reporting. */
export const defaultAiToolLimits = Object.freeze({
  maxModelCalls: 6, maxToolCalls: 12, modelTimeoutMs: 120_000, toolTimeoutMs: 30_000,
  runTimeoutMs: 300_000, inputTokenBudget: 16_000, totalInputTokenBudget: 100_000,
  maxOutputTokens: 4_096, maxToolResultBytes: 32_768,
});
export type AiToolLimits = { [K in keyof typeof defaultAiToolLimits]: number };
export type AiToolLimitKind = "model_calls" | "tool_calls" | "input_tokens" | "total_input_tokens" | "run_time";
export type AiToolBudgetSnapshot = {
  limits: AiToolLimits;
  modelCalls: number;
  toolCalls: number;
  successfulToolCalls: number;
  estimatedInputTokens: number;
  nextInputTokens: number;
  elapsedMs: number;
  pendingToolCalls: number;
  completedTools: Array<{ name: string; calls: number; items: number }>;
  limitKind?: AiToolLimitKind;
};
