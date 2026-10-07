import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { robotApiErrorResponse } from "@/lib/ai-robot-api";
import { RobotRequestError } from "@/lib/ai-robot-service";
import { z } from "zod";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request?: Request) {
  try {
    const mode = request ? new URL(request.url).searchParams.get("mode") ?? "normal" : "normal";
    if (mode !== "normal" && mode !== "task") throw new RobotRequestError("invalid_request", 400);
    const rows = await prisma.aiRobotConversation.findMany({ where: { mode }, orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      include: { _count: { select: { messages: true } }, messages: { orderBy: { sequence: "desc" }, take: 1, select: { content: true } } } });
    return NextResponse.json({ conversations: rows.map((row) => ({ id: row.id, title: row.title, messageCount: row._count.messages,
      preview: row.messages[0]?.content.slice(0, 120) ?? null, createdAt: row.createdAt, updatedAt: row.updatedAt })) });
  } catch (error) { return robotApiErrorResponse(error); }
}
export async function POST(request?: Request) {
  try {
    const raw = request ? await request.text() : "";
    let body: unknown;
    try { body = raw ? JSON.parse(raw) : {}; } catch { throw new RobotRequestError("invalid_request", 400); }
    const parsed = z.strictObject({ mode: z.enum(["normal", "task"]).default("normal") }).safeParse(body);
    if (!parsed.success) throw new RobotRequestError("invalid_request", 400);
    const row = await prisma.aiRobotConversation.create({ data: parsed.data });
    return NextResponse.json({ conversation: { ...row, messageCount: 0, preview: null } }, { status: 201 });
  } catch (error) { return robotApiErrorResponse(error); }
}
