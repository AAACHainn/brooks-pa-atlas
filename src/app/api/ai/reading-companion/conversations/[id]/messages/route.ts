import { NextResponse } from "next/server";
import { z } from "zod";

import { AiServiceError, streamAiChatCompletionEvents } from "@/lib/ai-client";
import {
  buildReadingCompanionMessages,
  readingConversationTitle,
  selectRecentReadingImageIds,
  selectRecentReadingMessages,
  serializeReadingMessage,
} from "@/lib/ai-reading-companion";
import {
  loadReadingImageContext,
  prepareReadingImageDataUrls,
} from "@/lib/ai-reading-context";
import {
  READING_COMPANION_SKILL_KEY,
  resolveAiEndpointUrls,
} from "@/lib/ai-config";
import { readStoredAiConfig } from "@/lib/ai-settings";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requestSchema = z.object({
  imageId: z.string().trim().min(1).max(200),
  content: z.string().trim().min(1).max(20_000),
});

function streamError(error: unknown) {
  if (error instanceof AiServiceError) return error.message;
  return "AI reading companion failed.";
}

function encodeEvent(value: unknown) {
  return new TextEncoder().encode(`${JSON.stringify(value)}\n`);
}

export async function POST(
  request: Request,
  context: RouteContext<"/api/ai/reading-companion/conversations/[id]/messages">,
) {
  const { id } = await context.params;
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "A message of at most 20,000 characters and a valid image are required." },
      { status: 400 },
    );
  }

  const [conversation, imageContext, config] = await Promise.all([
    prisma.aiReadingConversation.findUnique({ where: { id } }),
    loadReadingImageContext(parsed.data.imageId),
    readStoredAiConfig(),
  ]);
  if (!conversation) {
    return NextResponse.json({ error: "Conversation not found." }, { status: 404 });
  }
  if (!imageContext) {
    return NextResponse.json({ error: "Image not found." }, { status: 404 });
  }
  const endpoint = config.endpoints.find((item) => item.id === config.activeEndpointId);
  const skill = config.skills[READING_COMPANION_SKILL_KEY];
  const model = skill.modelOverride || endpoint?.defaultModel || "";
  if (!endpoint || !model) {
    return NextResponse.json(
      { error: "AI configuration is incomplete. Select an active endpoint and model." },
      { status: 409 },
    );
  }
  try {
    resolveAiEndpointUrls(endpoint);
  } catch {
    return NextResponse.json(
      { error: "AI endpoint URL is invalid." },
      { status: 409 },
    );
  }

  const userMessage = await prisma.$transaction(async (tx) => {
    const current = await tx.aiReadingConversation.findUniqueOrThrow({ where: { id } });
    const sequence = current.nextTurn * 2;
    await tx.aiReadingConversation.update({
      where: { id },
      data: {
        nextTurn: { increment: 1 },
        title: current.title ?? readingConversationTitle(parsed.data.content),
      },
    });
    return tx.aiReadingMessage.create({
      data: {
        conversationId: id,
        role: "USER",
        sequence,
        content: parsed.data.content,
        chartImageId: imageContext.id,
        imageContextJson: imageContext.snapshotJson,
      },
      include: { chartImage: { select: { id: true, title: true, originalName: true } } },
    });
  });

  const historyRows = (
    await prisma.aiReadingMessage.findMany({
    where: { conversationId: id, sequence: { lte: userMessage.sequence } },
    orderBy: { sequence: "desc" },
    take: 40,
    select: {
      role: true,
      content: true,
      chartImageId: true,
      imageContextJson: true,
    },
    })
  ).reverse();
  const history = selectRecentReadingMessages(historyRows);
  let imageDataUrls: Map<string, string>;
  try {
    imageDataUrls = await prepareReadingImageDataUrls(
      selectRecentReadingImageIds(history),
      { id: imageContext.id, libraryPath: imageContext.libraryPath },
    );
  } catch {
    return NextResponse.json(
      { error: "Could not prepare the reference image." },
      { status: 500 },
    );
  }
  const aiMessages = buildReadingCompanionMessages({
    prompt: skill.prompt,
    history,
    imageDataUrls,
  });

  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(
        encodeEvent({
          type: "start",
          userMessage: serializeReadingMessage(userMessage),
          conversation: {
            id,
            title: conversation.title ?? readingConversationTitle(parsed.data.content),
          },
        }),
      );
      let assistantText = "";
      let reasoningContent = "";
      const thinkingStartedAt = Date.now();
      let reasoningDurationMs: number | null = null;
      let thinkingFinished = false;
      controller.enqueue(encodeEvent({ type: "thinking_start" }));
      try {
        for await (const event of streamAiChatCompletionEvents(endpoint, model, aiMessages, {
          signal: request.signal,
        })) {
          if (event.type === "reasoning") {
            reasoningContent += event.text;
            controller.enqueue(encodeEvent({ type: "reasoning_delta", text: event.text }));
            continue;
          }
          if (!thinkingFinished) {
            thinkingFinished = true;
            reasoningDurationMs = Date.now() - thinkingStartedAt;
            controller.enqueue(
              encodeEvent({ type: "thinking_done", durationMs: reasoningDurationMs }),
            );
          }
          assistantText += event.text;
          controller.enqueue(encodeEvent({ type: "delta", text: event.text }));
        }
        if (!thinkingFinished) {
          reasoningDurationMs = Date.now() - thinkingStartedAt;
          controller.enqueue(
            encodeEvent({ type: "thinking_done", durationMs: reasoningDurationMs }),
          );
        }
        const saved = await prisma.$transaction(async (tx) => {
          const message = await tx.aiReadingMessage.create({
            data: {
              conversationId: id,
              role: "ASSISTANT",
              sequence: userMessage.sequence + 1,
              content: assistantText,
              reasoningContent: reasoningContent.trim() ? reasoningContent : null,
              reasoningDurationMs,
            },
            include: {
              chartImage: { select: { id: true, title: true, originalName: true } },
            },
          });
          await tx.aiReadingConversation.update({
            where: { id },
            data: { updatedAt: new Date() },
          });
          return message;
        });
        controller.enqueue(
          encodeEvent({ type: "done", assistantMessage: serializeReadingMessage(saved) }),
        );
      } catch (error) {
        try {
          controller.enqueue(encodeEvent({ type: "error", error: streamError(error) }));
        } catch {
          // The browser may have disconnected while the upstream request was active.
        }
      } finally {
        try {
          controller.close();
        } catch {
          // The stream may already be cancelled by the browser.
        }
      }
    },
  });

  return new Response(body, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
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
