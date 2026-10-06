import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { AiServiceError, streamAiChatCompletionEvents } from "@/lib/ai-client";
import { prepareDeepReading, validateDeepCitations } from "@/lib/ai-deep-reading";
import {
  buildReadingCompanionMessages, readingConversationTitle, selectReadingImageIdsForQuestion,
  selectRecentReadingMessages, serializeReadingMessage,
} from "@/lib/ai-reading-companion";
import { loadReadingImageContext, prepareReadingImageDataUrls } from "@/lib/ai-reading-context";
import { READING_COMPANION_SKILL_KEY, resolveAiEndpointUrls } from "@/lib/ai-config";
import { readStoredAiConfig } from "@/lib/ai-settings";
import { acquireHeavyTask, releaseHeavyTask } from "@/lib/background-task-coordinator";
import { prisma } from "@/lib/db";
import { retrieveKnowledgeContext, serializeKnowledgeForPrompt } from "@/lib/knowledge-search";
import type { KnowledgeContextSnapshot } from "@/lib/knowledge-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const requestSchema = z.object({
  imageId: z.string().trim().min(1).max(200),
  content: z.string().trim().min(1).max(20_000),
  answerMode: z.enum(["quick", "deep"]).default("quick"),
});
function streamError(error: unknown) {
  if (error instanceof AiServiceError) return error.message;
  if (error instanceof Error && /^(?:深度模式|当前问题)/.test(error.message)) return error.message;
  return "AI reading companion failed.";
}
function encodeEvent(value: unknown) {
  return new TextEncoder().encode(`${JSON.stringify(value)}\n`);
}

export async function POST(
  request: Request,
  routeContext: RouteContext<"/api/ai/reading-companion/conversations/[id]/messages">,
) {
  const { id } = await routeContext.params;
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "A valid image, answer mode and message of at most 20,000 characters are required." }, { status: 400 });
  const { content, answerMode } = parsed.data;
  const [conversation, imageContext, config] = await Promise.all([
    prisma.aiReadingConversation.findUnique({ where: { id } }),
    loadReadingImageContext(parsed.data.imageId), readStoredAiConfig(),
  ]);
  if (!conversation) return NextResponse.json({ error: "Conversation not found." }, { status: 404 });
  if (!imageContext) return NextResponse.json({ error: "Image not found." }, { status: 404 });
  const endpoint = config.endpoints.find((item) => item.id === config.activeEndpointId);
  const skill = config.skills[READING_COMPANION_SKILL_KEY];
  const model = skill.modelOverride || endpoint?.defaultModel || "";
  if (!endpoint || !model) return NextResponse.json({ error: "AI configuration is incomplete. Select an active endpoint and model." }, { status: 409 });
  try { resolveAiEndpointUrls(endpoint); }
  catch { return NextResponse.json({ error: "AI endpoint URL is invalid." }, { status: 409 }); }
  const leaseId = randomUUID();
  const isDeep = answerMode === "deep";
  if (isDeep && !acquireHeavyTask("ai-deep-reading", leaseId)) {
    return NextResponse.json({ error: "已有后台重任务正在运行，请等待完成后再使用深度思考。" }, { status: 409 });
  }
  const abortController = new AbortController();
  const abortFromRequest = () => abortController.abort();
  request.signal.addEventListener("abort", abortFromRequest, { once: true });
  if (request.signal.aborted) abortController.abort();
  const signal = abortController.signal;
  const cleanup = () => {
    request.signal.removeEventListener("abort", abortFromRequest);
    if (isDeep) releaseHeavyTask("ai-deep-reading", leaseId);
  };
  try {
    signal.throwIfAborted();
    const userMessage = await prisma.$transaction(async (tx) => {
      const current = await tx.aiReadingConversation.findUniqueOrThrow({ where: { id } });
      const sequence = current.nextTurn * 2;
      await tx.aiReadingConversation.update({
        where: { id },
        data: { nextTurn: { increment: 1 }, title: current.title ?? readingConversationTitle(content) },
      });
      return tx.aiReadingMessage.create({
        data: {
          conversationId: id, role: "USER", sequence, content, chartImageId: imageContext.id,
          imageContextJson: imageContext.snapshotJson,
          knowledgeContextJson: JSON.stringify({ sources: [], semanticSearchUsed: false, hasCurrentBinding: false, warning: null, answerMode }),
        },
        include: { chartImage: { select: { id: true, title: true, originalName: true } } },
      });
    });
    const body = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (event: unknown) => {
          if (signal.aborted) return;
          try { controller.enqueue(encodeEvent(event)); }
          catch { abortController.abort(); signal.throwIfAborted(); }
        };
        const heartbeat = setInterval(() => {
          try { send({ type: "ping" }); } catch { abortController.abort(); }
        }, 10_000);
        let knowledgeContext: KnowledgeContextSnapshot = {
          sources: [], semanticSearchUsed: false, hasCurrentBinding: false, warning: null, answerMode,
        };
        let assistantText = "";
        let reasoningContent = "";
        let reasoningDurationMs: number | null = null;
        try {
          send({ type: "start", userMessage: serializeReadingMessage(userMessage),
            conversation: { id, title: conversation.title ?? readingConversationTitle(content) }, answerMode });
          const historyRows = (await prisma.aiReadingMessage.findMany({
            where: { conversationId: id, sequence: { lte: userMessage.sequence } },
            orderBy: { sequence: "desc" }, take: 40,
            select: { role: true, content: true, chartImageId: true, imageContextJson: true },
          })).reverse();
          const history = selectRecentReadingMessages(historyRows);
          const imageDataUrls = await prepareReadingImageDataUrls(
            selectReadingImageIdsForQuestion(history, content), { id: imageContext.id, libraryPath: imageContext.libraryPath },
          );
          signal.throwIfAborted();
          let aiMessages;
          let clarification: string | undefined;
          if (isDeep) {
            const prepared = await prepareDeepReading({
              endpoint, model, skill, query: content, indexNodeId: imageContext.indexNodeId,
              history, imageDataUrls, signal,
              onProgress: (progress) => send({ type: "progress", ...progress }),
            });
            knowledgeContext = prepared.context;
            aiMessages = prepared.messages;
            clarification = prepared.clarification;
          } else {
            try {
              const snapshot = imageContext.snapshot;
              knowledgeContext = { ...await retrieveKnowledgeContext({
                query: content, indexNodeId: imageContext.indexNodeId, signal,
                contextText: [
                  snapshot.index?.path ?? "", snapshot.title ?? "", snapshot.tags.join(" "),
                  snapshot.ocr.text?.slice(0, 4_000) ?? "", snapshot.notes?.slice(0, 2_000) ?? "",
                  snapshot.index?.navigatorAttributes.map((item) => `${item.category}:${item.values.join(",")}`).join(" ") ?? "",
                ].filter(Boolean).join("\n"),
              }), answerMode };
            } catch { signal.throwIfAborted(); }
            aiMessages = buildReadingCompanionMessages({
              prompt: skill.prompt, history, imageDataUrls,
              knowledgeContextText: serializeKnowledgeForPrompt(knowledgeContext),
            });
          }
          const thinkingStartedAt = Date.now();
          let thinkingFinished = false;
          send({ type: "thinking_start" });
          const answerEvents = clarification
            ? (async function* () { yield { type: "content" as const, text: clarification! }; })()
            : streamAiChatCompletionEvents(endpoint, model, aiMessages, {
              signal, ...(isDeep ? { maxOutputTokens: skill.deepMaxOutputTokens } : {}),
            });
          for await (const event of answerEvents) {
            signal.throwIfAborted();
            if (event.type === "reasoning") {
              reasoningContent += event.text;
              send({ type: "reasoning_delta", text: event.text });
              continue;
            }
            if (!thinkingFinished) {
              thinkingFinished = true;
              reasoningDurationMs = Date.now() - thinkingStartedAt;
              send({ type: "thinking_done", durationMs: reasoningDurationMs });
            }
            assistantText += event.text;
            send({ type: "delta", text: event.text });
          }
          signal.throwIfAborted();
          if (!thinkingFinished) {
            reasoningDurationMs = Date.now() - thinkingStartedAt;
            send({ type: "thinking_done", durationMs: reasoningDurationMs });
          }
          const validated = validateDeepCitations(assistantText, knowledgeContext.sources);
          assistantText = validated.text;
          if (validated.invalid && knowledgeContext.research) knowledgeContext.research.warnings.push("回答包含未验证引用，已标记并取消来源映射。");
          const coverage = knowledgeContext.research?.coverage;
          if (coverage && !coverage.complete && coverage.availableChunks) {
            assistantText += /[\p{Script=Han}]/u.test(content)
              ? `\n\n> 本次读取 ${coverage.readChunks}/${coverage.availableChunks} 个${knowledgeContext.research?.intent === "summary" ? "目标" : "召回"}片段，资料覆盖不完整；以上回答仅依据已读取证据。`
              : `\n\n> This answer uses ${coverage.readChunks}/${coverage.availableChunks} available evidence chunks; coverage is incomplete.`;
          }
          const saved = await prisma.$transaction(async (tx) => {
            signal.throwIfAborted();
            const message = await tx.aiReadingMessage.create({
              data: {
                conversationId: id, role: "ASSISTANT", sequence: userMessage.sequence + 1,
                content: assistantText, reasoningContent: reasoningContent.trim() || null,
                reasoningDurationMs, knowledgeContextJson: JSON.stringify(knowledgeContext),
              },
              include: { chartImage: { select: { id: true, title: true, originalName: true } } },
            });
            await tx.aiReadingConversation.update({ where: { id }, data: { updatedAt: new Date() } });
            signal.throwIfAborted();
            return message;
          });
          send({ type: "done", assistantMessage: serializeReadingMessage(saved) });
        } catch (error) {
          try { send({ type: "error", error: streamError(error) }); } catch { /* Client disconnected. */ }
        } finally {
          clearInterval(heartbeat);
          cleanup();
          try { controller.close(); } catch { /* Stream was cancelled. */ }
        }
      },
      cancel() { abortController.abort(); },
    });
    return new Response(body, {
      headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" },
    });
  } catch (error) {
    cleanup();
    return NextResponse.json({ error: streamError(error) }, { status: 500 });
  }
}

export async function DELETE(
  _request: Request,
  context: RouteContext<"/api/ai/reading-companion/conversations/[id]/messages">,
) {
  const { id } = await context.params;
  const conversation = await prisma.aiReadingConversation.findUnique({ where: { id } });
  if (!conversation) {
    return NextResponse.json({ error: "Conversation not found." }, { status: 404 });
  }
  await prisma.aiReadingMessage.deleteMany({ where: { conversationId: id } });
  await prisma.aiReadingConversation.update({
    where: { id },
    data: { nextTurn: 0 },
  });
  return NextResponse.json({ ok: true });
}
