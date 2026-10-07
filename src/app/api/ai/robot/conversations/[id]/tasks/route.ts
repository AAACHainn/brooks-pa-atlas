import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { robotApiErrorResponse } from "@/lib/ai-robot-api";
import { RobotRequestError } from "@/lib/ai-robot-service";
import { taskCreateSchema } from "@/lib/ai-robot-task-types";
import { createRobotTask, getRobotTask } from "@/lib/ai-robot-task-service";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: Context) {
  try {
    const { id } = await context.params;
    const conversation = await prisma.aiRobotConversation.findUnique({ where: { id } });
    if (!conversation) throw new RobotRequestError("not_found", 404);
    const before = new URL(request.url).searchParams.get("before");
    const cursor = before ? await prisma.aiRobotTask.findFirst({ where: { id: before, conversationId: id }, select: { id: true, createdAt: true } }) : null;
    if (before && !cursor) throw new RobotRequestError("invalid_request", 400);
    const rows = await prisma.aiRobotTask.findMany({ where: { conversationId: id, ...(cursor ? { OR: [{ createdAt: { lt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { lt: cursor.id } }] } : {}) }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 21, select: { id: true } });
    const tasks = [];
    for (const row of rows.slice(0, 20)) tasks.push(await getRobotTask(row.id, false));
    return NextResponse.json({ tasks, nextBefore: rows.length > 20 ? rows[19].id : null });
  } catch (error) { return robotApiErrorResponse(error); }
}
export async function POST(request: Request, context: Context) {
  const parsed = taskCreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return robotApiErrorResponse(new RobotRequestError("invalid_request", 400));
  try { return NextResponse.json({ task: await createRobotTask((await context.params).id, parsed.data) }, { status: 202 }); }
  catch (error) { return robotApiErrorResponse(error, parsed.data.locale); }
}
