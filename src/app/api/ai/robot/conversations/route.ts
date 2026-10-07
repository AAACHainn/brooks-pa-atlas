import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { robotApiErrorResponse } from "@/lib/ai-robot-api";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    const rows = await prisma.aiRobotConversation.findMany({ orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      include: { _count: { select: { messages: true } }, messages: { orderBy: { sequence: "desc" }, take: 1, select: { content: true } } } });
    return NextResponse.json({ conversations: rows.map((row) => ({ id: row.id, title: row.title, messageCount: row._count.messages,
      preview: row.messages[0]?.content.slice(0, 120) ?? null, createdAt: row.createdAt, updatedAt: row.updatedAt })) });
  } catch (error) { return robotApiErrorResponse(error); }
}
export async function POST() {
  try {
    const row = await prisma.aiRobotConversation.create({ data: {} });
    return NextResponse.json({ conversation: { ...row, messageCount: 0, preview: null } }, { status: 201 });
  } catch (error) { return robotApiErrorResponse(error); }
}
