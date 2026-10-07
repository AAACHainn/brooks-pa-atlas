import { NextResponse } from "next/server";
import { taskActionSchema } from "@/lib/ai-robot-task-types";
import { RobotRequestError } from "@/lib/ai-robot-service";
import { robotApiErrorResponse } from "@/lib/ai-robot-api";
import { controlRobotTask } from "@/lib/ai-robot-task-service";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const parsed = taskActionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return robotApiErrorResponse(new RobotRequestError("invalid_request", 400));
  try { return NextResponse.json({ task: await controlRobotTask((await context.params).id, parsed.data) }); }
  catch (error) { return robotApiErrorResponse(error); }
}
