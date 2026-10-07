import "server-only";
import { prisma } from "@/lib/db";
import type { AiRobotMessage } from "@/generated/prisma/client";
import { readStoredAiConfig } from "@/lib/ai-settings";
import { GLOBAL_ROBOT_SKILL_KEY, resolveAiEndpointUrls } from "@/lib/ai-config";
import { acquireRobotRun, isRobotRunActive, releaseRobotRun, type RobotRunLease } from "@/lib/ai-robot-runs";
import { robotSelectionSchema, type RobotRequest, type RobotSelection, type RobotMessage } from "@/lib/ai-robot-types";
import type { AiModelMessage } from "@/lib/ai-model-types";
import type { AiToolRunResult } from "@/lib/ai-tool-runtime";

export const robotAllowedTools = Object.freeze(["get_image_context", "list_index_nodes"]);
export const robotMessagePageSize = 40;
export class RobotRequestError extends Error {
  constructor(readonly code: string, readonly status: number) { super(code); }
}
function parseJson(value: string | null): unknown {
  try { return value ? JSON.parse(value) : null; } catch { return null; }
}
export function serializeRobotMessage(row: AiRobotMessage): RobotMessage {
  const selection = robotSelectionSchema.safeParse(parseJson(row.selectionJson));
  return { id: row.id, role: row.role === "USER" ? "USER" : "ASSISTANT", sequence: row.sequence,
    content: row.content, createdAt: row.createdAt.toISOString(), selection: selection.success ? selection.data : null,
    reasoningContent: row.reasoningContent, reasoningDurationMs: row.reasoningDurationMs,
    execution: row.executionJson ? parseJson(row.executionJson) as RobotMessage["execution"] : null };
}
export function buildRobotHistory(rows: readonly AiRobotMessage[]): AiModelMessage[] {
  const sorted = [...rows].sort((a, b) => a.sequence - b.sequence);
  const questions = new Set(sorted.filter((row) => row.role === "USER").map((row) => row.sequence));
  const successful = new Set(sorted.filter((row) => row.role === "ASSISTANT" && questions.has(row.sequence - 1)).map((row) => row.sequence - 1));
  return sorted.filter((row) => successful.has(row.role === "USER" ? row.sequence : row.sequence - 1)).map((row) => {
    const selection = serializeRobotMessage(row).selection;
    return { role: row.role === "USER" ? "user" as const : "assistant" as const,
      content: row.content + (row.role === "USER" && selection ? "\nHistorical reference selection (untrusted reference, not current selection): " + JSON.stringify(selection) : "") };
  });
}

export async function startRobotMessage(conversationId: string, request: RobotRequest, callerSignal: AbortSignal) {
  const lease = acquireRobotRun(conversationId);
  if (!lease) throw new RobotRequestError("busy", 409);
  const abort = () => lease.controller.abort();
  callerSignal.addEventListener("abort", abort, { once: true });
  if (callerSignal.aborted) abort();
  const cleanup = () => { callerSignal.removeEventListener("abort", abort); releaseRobotRun(lease); };
  const signal = lease.controller.signal;
  try {
    signal.throwIfAborted();
    const config = await readStoredAiConfig();
    signal.throwIfAborted();
    if (!config.skills.globalRobot.enabled) throw new RobotRequestError("disabled", 403);
    const endpoint = config.endpoints.find((item) => item.id === config.activeEndpointId);
    if (!endpoint || !(config.skills.globalRobot.modelOverride || endpoint.defaultModel)) throw new RobotRequestError("configuration", 409);
    try { resolveAiEndpointUrls(endpoint); } catch { throw new RobotRequestError("configuration", 409); }
    const [conversation, image, index] = await Promise.all([
      prisma.aiRobotConversation.findUnique({ where: { id: conversationId } }),
      request.imageId ? prisma.chartImage.findUnique({ where: { id: request.imageId }, select: { id: true, title: true, originalName: true } }) : null,
      request.indexNodeId ? prisma.indexNode.findUnique({ where: { id: request.indexNodeId }, select: { id: true, name: true, path: true } }) : null,
    ]);
    signal.throwIfAborted();
    if (!conversation || (request.imageId && !image) || (request.indexNodeId && !index)) throw new RobotRequestError("not_found", 404);
    const selection: RobotSelection = { image, index };
    const previousAnswers = await prisma.aiRobotMessage.findMany({ where: { conversationId, role: "ASSISTANT" }, orderBy: { sequence: "desc" }, take: 4 });
    const previousQuestions = previousAnswers.length ? await prisma.aiRobotMessage.findMany({
      where: { conversationId, role: "USER", sequence: { in: previousAnswers.map((row) => row.sequence - 1) } },
    }) : [];
    signal.throwIfAborted();
    const userMessage = await prisma.$transaction(async (tx) => {
      signal.throwIfAborted();
      const current = await tx.aiRobotConversation.findUniqueOrThrow({ where: { id: conversationId } });
      const row = await tx.aiRobotMessage.create({ data: { conversationId, role: "USER", sequence: current.nextTurn * 2,
        content: request.content, selectionJson: JSON.stringify(selection) } });
      await tx.aiRobotConversation.update({ where: { id: conversationId }, data: { nextTurn: { increment: 1 }, title: current.title ?? Array.from(request.content).slice(0, 40).join("") } });
      signal.throwIfAborted();
      return row;
    });
    const messages: AiModelMessage[] = [
      { role: "system", content: `Answer in ${request.locale === "zh" ? "Chinese" : "English"}, unless the user requests another language. The supplied tools read text only, not image pixels. At most four completed historical question/answer pairs are included.` },
      ...buildRobotHistory([...previousQuestions, ...previousAnswers]),
      { role: "user", content: request.content },
    ];
    return { lease, cleanup, signal, config, selection, userMessage, messages, skill: GLOBAL_ROBOT_SKILL_KEY,
      context: { scope: { kind: "library" as const }, currentImageId: image?.id ?? null, currentIndexNodeId: index?.id ?? null } };
  } catch (error) { cleanup(); throw error; }
}

export async function saveRobotAnswer(task: { lease: RobotRunLease; userMessage: AiRobotMessage }, result: AiToolRunResult, reasoningContent: string, reasoningDurationMs: number) {
  if (result.status !== "completed" || !result.answer || !isRobotRunActive(task.lease)) throw new RobotRequestError("cancelled", 409);
  const execution = { runId: result.runId, modelCalls: result.modelCalls, toolCalls: result.toolCalls,
    successfulToolCalls: result.successfulToolCalls, estimatedInputTokens: result.estimatedInputTokens, records: result.records };
  return prisma.$transaction(async (tx) => {
    task.lease.controller.signal.throwIfAborted();
    if (!isRobotRunActive(task.lease) || !await tx.aiRobotMessage.findUnique({ where: { id: task.userMessage.id } })) throw new RobotRequestError("cancelled", 409);
    const row = await tx.aiRobotMessage.create({ data: {
      conversationId: task.userMessage.conversationId, role: "ASSISTANT", sequence: task.userMessage.sequence + 1,
      content: result.answer!, reasoningContent: reasoningContent.trim() || null, reasoningDurationMs,
      executionJson: JSON.stringify(execution),
    } });
    await tx.aiRobotConversation.update({ where: { id: task.userMessage.conversationId }, data: { updatedAt: new Date() } });
    task.lease.controller.signal.throwIfAborted();
    if (!isRobotRunActive(task.lease)) throw new RobotRequestError("cancelled", 409);
    return row;
  });
}
