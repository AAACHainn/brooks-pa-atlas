import { z } from "zod";
import type { AiToolTraceRecord } from "@/lib/ai-tool-runtime";
import type { AiToolBudgetSnapshot, AiToolLimitKind } from "@/lib/ai-tool-limits";

export type RobotLocale = "zh" | "en";
const id = z.string().trim().min(1).max(200);
export const robotRequestSchema = z.strictObject({
  content: z.string().trim().min(1).max(20_000), locale: z.enum(["zh", "en"]).default("zh"),
  imageId: id.nullable().optional(), indexNodeId: id.nullable().optional(),
});
export type RobotRequest = z.infer<typeof robotRequestSchema>;
export const robotSelectionSchema = z.object({
  image: z.object({ id, title: z.string().nullable(), originalName: z.string() }).nullable(),
  index: z.object({ id, name: z.string(), path: z.string() }).nullable(),
});
export type RobotSelection = z.infer<typeof robotSelectionSchema>;
export type RobotExecution = { runId: string; modelCalls: number; toolCalls: number; successfulToolCalls: number; estimatedInputTokens: number; records: AiToolTraceRecord[]; budget?: AiToolBudgetSnapshot; warnings?: string[] };
export type RobotConversation = { id: string; title: string | null; messageCount: number; preview: string | null; createdAt: string; updatedAt: string };
export type RobotMessage = {
  id: string; role: "USER" | "ASSISTANT"; sequence: number; content: string; createdAt: string;
  selection: RobotSelection | null; reasoningContent: string | null; reasoningDurationMs: number | null;
  execution: RobotExecution | null;
};
export type RobotStreamEvent =
  | { type: "ping" }
  | { type: "user_message"; message: RobotMessage }
  | { type: "delta"; runId: string; round: number; channel: "content" | "reasoning"; text: string }
  | { type: "trace"; record: AiToolTraceRecord }
  | { type: "done"; message: RobotMessage }
  | { type: "error"; code: string; error: string; budget?: AiToolBudgetSnapshot };

export function robotBudgetReason(kind: AiToolLimitKind | undefined, locale: RobotLocale) {
  const reasons: Record<AiToolLimitKind, [string, string]> = {
    model_calls: ["模型请求次数上限", "Model request limit"], tool_calls: ["工具调用次数上限", "Tool call limit"],
    input_tokens: ["单次输入 Token 预算", "Input-token budget per request"], total_input_tokens: ["累计输入 Token 预算", "Total input-token budget"],
    run_time: ["任务总时长上限", "Task time limit"],
  };
  return kind ? reasons[kind][locale === "zh" ? 0 : 1] : locale === "zh" ? "运行预算" : "Execution budget";
}

export function robotBudgetFeedback(budget: AiToolBudgetSnapshot, locale: RobotLocale) {
  const zh = locale === "zh", number = (value: number) => value.toLocaleString(zh ? "zh-CN" : "en-US");
  const lines = [zh ? `模型请求 ${budget.modelCalls}/${budget.limits.maxModelCalls} 次；工具调用 ${budget.toolCalls}/${budget.limits.maxToolCalls} 次（成功 ${budget.successfulToolCalls} 次）。`
    : `Model requests ${budget.modelCalls}/${budget.limits.maxModelCalls}; tool calls ${budget.toolCalls}/${budget.limits.maxToolCalls} (${budget.successfulToolCalls} succeeded).`];
  if (budget.limitKind === "input_tokens") lines.push(zh
    ? `下次输入估算 ${number(budget.nextInputTokens)} Token；单次预算 ${number(budget.limits.inputTokenBudget)}，扣除安全余量后可用 ${number(Math.floor(budget.limits.inputTokenBudget * 0.9))}。`
    : `Next input estimate: ${number(budget.nextInputTokens)} tokens; per-request budget: ${number(budget.limits.inputTokenBudget)}, with ${number(Math.floor(budget.limits.inputTokenBudget * 0.9))} available after headroom.`);
  else lines.push(zh ? `累计输入估算 ${number(budget.estimatedInputTokens)}/${number(budget.limits.totalInputTokenBudget)} Token；已运行 ${Math.ceil(budget.elapsedMs / 1000)}/${budget.limits.runTimeoutMs / 1000} 秒。`
    : `Estimated total input ${number(budget.estimatedInputTokens)}/${number(budget.limits.totalInputTokenBudget)} tokens; elapsed ${Math.ceil(budget.elapsedMs / 1000)}/${budget.limits.runTimeoutMs / 1000} seconds.`);
  if (budget.completedTools.length) lines.push((zh ? "已完成读取：" : "Completed reads: ") + budget.completedTools.map((tool) => `${robotToolLabel(tool.name, locale)} × ${tool.calls}`).join(zh ? "；" : "; "));
  else lines.push(zh ? "尚未完成任何工具读取。" : "No tool read has completed.");
  if (budget.pendingToolCalls) lines.push(zh ? `还有 ${budget.pendingToolCalls} 个工具调用未完成。` : `${budget.pendingToolCalls} tool calls remain unfinished.`);
  return lines;
}

export function robotToolLabel(name: string | undefined, locale: RobotLocale) {
  if (name === "get_image_context") return locale === "zh" ? "读取图片资料" : "Read image context";
  if (name === "list_index_nodes") return locale === "zh" ? "查询索引" : "Search indexes";
  return locale === "zh" ? "执行工具" : "Run tool";
}
export function robotErrorMessage(code: string, locale: RobotLocale) {
  const messages: Record<string, [string, string]> = {
    storage_upgrade_required: ["AI 机器人会话数据库尚未升级，请在服务端执行 npm run db:migrate 和 npm run prisma:generate，再重启服务。", "The robot conversation database needs an upgrade. Run npm run db:migrate and npm run prisma:generate on the server, then restart it."],
    invalid_response_body: ["机器人服务返回了无效响应，请刷新页面或重启服务后重试。", "The robot service returned an invalid response. Refresh the page or restart the server and try again."],
    network_error: ["无法连接机器人服务，请检查服务是否运行后重试。", "Cannot connect to the robot service. Check that the server is running and try again."],
    disabled: ["AI 机器人已在设置中关闭。", "The AI robot is disabled in settings."],
    configuration: ["请在管理模式的设置中配置启用端点和 AI 机器人模型。", "Configure an active endpoint and robot model in management settings."],
    "unsupported-tools": ["当前端点或模型不支持工具调用，请在设置中选择支持工具的模型。", "This endpoint or model does not support tools. Select a compatible model."],
    busy: ["此会话已有任务正在运行。", "This conversation already has a running task."],
    stale_task: ["任务状态已更新，请刷新后重试。", "The task changed. Refresh and try again."],
    cancelled: ["已停止，未完成的回答不会保存。", "Stopped. Unfinished answers are not saved."],
    budget_exceeded: ["已达到调用或输入预算，请缩短问题或新建会话。", "The call or input budget was reached. Shorten the question or start a new conversation."],
    tool_call_limit: ["已达到工具调用次数上限，请缩小问题范围。", "The tool call limit was reached. Narrow the question."],
    final_answer_required: ["已接近运行上限，但模型仍请求更多工具，本次任务已停止。", "The model requested more tools when a final answer was required near the execution limit. The task stopped."],
    model_timeout: ["模型请求超时，请稍后重试。", "The model request timed out. Try again later."],
    tool_timeout: ["工具读取超时，本次任务已停止。", "The tool timed out and the task stopped."],
    run_timeout: ["本次任务超时，未保存未完成的回答。", "The task timed out. The unfinished answer was not saved."],
    invalid_response: ["模型响应不完整或格式无效，未执行不完整的调用。", "The model response was incomplete or invalid."],
    not_found: ["会话或当前参考资料已不存在，请刷新后重试。", "The conversation or selected resource no longer exists. Refresh and try again."],
    invalid_request: ["请提供有效问题和参考对象。", "Provide a valid question and selection."],
  };
  return messages[code]?.[locale === "zh" ? 0 : 1] ?? (locale === "zh" ? "AI 机器人请求失败，请稍后重试。" : "The AI robot request failed. Try again later.");
}
