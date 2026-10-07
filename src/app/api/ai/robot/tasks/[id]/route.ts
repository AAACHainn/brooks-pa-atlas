import { NextResponse } from "next/server";
import { robotApiErrorResponse } from "@/lib/ai-robot-api";
import { getRobotTask } from "@/lib/ai-robot-task-service";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try { return NextResponse.json({ task: await getRobotTask((await context.params).id, new URL(request.url).searchParams.get("evidence") === "true") }); }
  catch (error) { return robotApiErrorResponse(error); }
}
