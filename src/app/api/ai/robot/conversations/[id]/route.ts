import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { robotApiErrorResponse } from "@/lib/ai-robot-api";
import { mutateRobotConversation } from "@/lib/ai-robot-runs";
import { RobotRequestError, robotMessagePageSize, serializeRobotMessage } from "@/lib/ai-robot-service";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const titleSchema = z.strictObject({ title: z.string().trim().min(1).max(120) });
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: Context) {
  try {
    const { id } = await context.params;
    const before = new URL(request.url).searchParams.get("before");
    if (before !== null && (!/^\d+$/.test(before) || !Number.isSafeInteger(Number(before)))) throw new RobotRequestError("invalid_request", 400);
    const conversation = await prisma.aiRobotConversation.findUnique({ where: { id } });
    if (!conversation) throw new RobotRequestError("not_found", 404);
    const rows = await prisma.aiRobotMessage.findMany({ where: { conversationId: id, ...(before !== null ? { sequence: { lt: Number(before) } } : {}) },
      orderBy: { sequence: "desc" }, take: robotMessagePageSize + 1 });
    const page = rows.slice(0, robotMessagePageSize).reverse();
    return NextResponse.json({ conversation, messages: page.map(serializeRobotMessage), nextBefore: rows.length > robotMessagePageSize ? page[0]?.sequence ?? null : null });
  } catch (error) { return robotApiErrorResponse(error); }
}
export async function PATCH(request: Request, context: Context) {
  const { id } = await context.params;
  const parsed = titleSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return robotApiErrorResponse(new RobotRequestError("invalid_request", 400));
  try { return NextResponse.json({ conversation: await prisma.aiRobotConversation.update({ where: { id }, data: parsed.data }) }); }
  catch (error) { return robotApiErrorResponse(error); }
}
export async function DELETE(_request: Request, context: Context) {
  const { id } = await context.params;
  try { await mutateRobotConversation(id, async () => {
    await (await import("@/lib/ai-robot-task-service")).stopConversationTasks(id);
    return prisma.aiRobotConversation.delete({ where: { id } });
  }); return NextResponse.json({ ok: true }); }
  catch (error) { return robotApiErrorResponse(error); }
}
