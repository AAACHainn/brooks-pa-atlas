import { NextResponse } from "next/server";

import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const conversations = await prisma.aiReadingConversation.findMany({
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
    include: {
      _count: { select: { messages: true } },
      messages: {
        orderBy: { sequence: "desc" },
        take: 1,
        select: { content: true, role: true },
      },
    },
  });
  return NextResponse.json({
    conversations: conversations.map((conversation) => ({
      id: conversation.id,
      title: conversation.title,
      messageCount: conversation._count.messages,
      preview: conversation.messages[0]?.content.slice(0, 120) ?? null,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
    })),
  });
}

export async function POST() {
  const conversation = await prisma.aiReadingConversation.create({ data: {} });
  return NextResponse.json(
    {
      conversation: {
        id: conversation.id,
        title: conversation.title,
        messageCount: 0,
        preview: null,
        createdAt: conversation.createdAt,
        updatedAt: conversation.updatedAt,
      },
    },
    { status: 201 },
  );
}
