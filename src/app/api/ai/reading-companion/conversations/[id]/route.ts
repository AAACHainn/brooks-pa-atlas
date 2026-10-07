import { NextResponse } from "next/server";
import { mutateReadingConversation } from "@/lib/reading-companion-runs";
import { z } from "zod";

import {
  parseReadingMessageBefore,
  readingMessagePageSize,
  serializeReadingMessage,
} from "@/lib/ai-reading-companion";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const patchSchema = z.object({ title: z.string().trim().min(1).max(120) });

export async function GET(
  request: Request,
  context: RouteContext<"/api/ai/reading-companion/conversations/[id]">,
) {
  const { id } = await context.params;
  const url = new URL(request.url);
  const before = parseReadingMessageBefore(url.searchParams.get("before"));
  const conversation = await prisma.aiReadingConversation.findUnique({ where: { id } });
  if (!conversation) {
    return NextResponse.json({ error: "Conversation not found." }, { status: 404 });
  }
  const rows = await prisma.aiReadingMessage.findMany({
    where: {
      conversationId: id,
      ...(before === null ? {} : { sequence: { lt: before } }),
    },
    orderBy: { sequence: "desc" },
    take: readingMessagePageSize + 1,
    include: { chartImage: { select: { id: true, title: true, originalName: true } } },
  });
  const hasMore = rows.length > readingMessagePageSize;
  const page = rows.slice(0, readingMessagePageSize).reverse();
  return NextResponse.json({
    conversation: {
      id: conversation.id,
      title: conversation.title,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
    },
    messages: page.map(serializeReadingMessage),
    nextBefore: hasMore ? page[0]?.sequence ?? null : null,
  });
}

export async function PATCH(
  request: Request,
  context: RouteContext<"/api/ai/reading-companion/conversations/[id]">,
) {
  const { id } = await context.params;
  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "A title of at most 120 characters is required." }, { status: 400 });
  }
  try {
    const conversation = await prisma.aiReadingConversation.update({
      where: { id },
      data: { title: parsed.data.title },
    });
    return NextResponse.json({ conversation });
  } catch {
    return NextResponse.json({ error: "Conversation not found." }, { status: 404 });
  }
}

export async function DELETE(
  _request: Request,
  context: RouteContext<"/api/ai/reading-companion/conversations/[id]">,
) {
  const { id } = await context.params;
  try {
    await mutateReadingConversation(id, () => prisma.aiReadingConversation.delete({ where: { id } }));
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Conversation not found." }, { status: 404 });
  }
}
