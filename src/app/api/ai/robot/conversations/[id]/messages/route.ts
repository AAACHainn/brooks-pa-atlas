import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { robotApiErrorDetails, robotApiErrorResponse } from "@/lib/ai-robot-api";
import { mutateRobotConversation } from "@/lib/ai-robot-runs";
import { robotRequestSchema, robotErrorMessage, type RobotStreamEvent } from "@/lib/ai-robot-types";
import { startRobotMessage, saveRobotAnswer, serializeRobotMessage, robotAllowedTools, RobotRequestError } from "@/lib/ai-robot-service";
import { createSystemToolRegistry } from "@/lib/ai-system-tools";
import { runAiToolTask } from "@/lib/ai-tool-runtime";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };
export async function POST(request: Request, context: Context) {
  const { id } = await context.params;
  const parsed = robotRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ code: "invalid_request", error: robotErrorMessage("invalid_request", "zh") }, { status: 400 });
  const locale = parsed.data.locale;
  let task: Awaited<ReturnType<typeof startRobotMessage>>;
  try { task = await startRobotMessage(id, parsed.data, request.signal); }
  catch (error) {
    return robotApiErrorResponse(request.signal.aborted ? new RobotRequestError("cancelled", 409) : error, locale);
  }
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: RobotStreamEvent) => {
        task.signal.throwIfAborted();
        try { controller.enqueue(new TextEncoder().encode(JSON.stringify(event) + "\n")); }
        catch { task.lease.controller.abort(); task.signal.throwIfAborted(); }
      };
      const heartbeat = setInterval(() => { try { send({ type: "ping" }); } catch { task.lease.controller.abort(); } }, 10_000);
      let reasoning = "";
      let reasoningStarted = 0;
      let reasoningDuration = 0;
      try {
        send({ type: "user_message", message: serializeRobotMessage(task.userMessage) });
        const result = await runAiToolTask({
          messages: task.messages, registry: createSystemToolRegistry({ pagedImageContext: true }), allowedTools: robotAllowedTools,
          context: task.context, config: task.config, skill: task.skill, signal: task.signal,
          limits: task.limits, finishNearLimit: true,
          onEvent(event) {
            if (event.type === "trace") {
              if (event.record.type === "model_started") reasoningStarted = 0;
              if (event.record.type === "model_completed" && reasoningStarted) reasoningDuration += Date.now() - reasoningStarted;
              send({ type: "trace", record: event.record });
            } else {
              if (event.channel === "reasoning") {
                if (!reasoningStarted) { reasoningStarted = Date.now(); if (reasoning) reasoning += "\n\n"; }
                reasoning += event.text;
              }
              send({ type: "delta", runId: event.runId, round: event.round, channel: event.channel, text: event.text });
            }
          },
        });
        task.signal.throwIfAborted();
        if (result.status !== "completed") { const code = result.error?.code ?? "execution_failed"; send({ type: "error", code, error: robotErrorMessage(code, locale), budget: result.budget }); }
        else {
          const saved = await saveRobotAnswer(task, result, reasoning, reasoningDuration);
          send({ type: "done", message: serializeRobotMessage(saved) });
        }
      } catch (error) {
        if (task.signal.aborted && !request.signal.aborted) {
          // A different tab may clear/delete the conversation or disable the robot.
          // Deliver a terminal status while the client connection is still open.
          try { controller.enqueue(new TextEncoder().encode(JSON.stringify({ type: "error", code: "cancelled", error: robotErrorMessage("cancelled", locale) }) + "\n")); } catch { /* Disconnected. */ }
        } else if (!task.signal.aborted) {
          const { code } = robotApiErrorDetails(error);
          try { send({ type: "error", code, error: robotErrorMessage(code, locale) }); } catch { /* Disconnected. */ }
        }
      } finally {
        clearInterval(heartbeat); task.cleanup();
        try { controller.close(); } catch { /* Stream already cancelled. */ }
      }
    },
    cancel() { task.lease.controller.abort(); },
  });
  return new Response(body, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" } });
}
export async function DELETE(_request: Request, context: Context) {
  const { id } = await context.params;
  try {
    return await mutateRobotConversation(id, async () => {
      if (!await prisma.aiRobotConversation.findUnique({ where: { id } })) throw new RobotRequestError("not_found", 404);
      await (await import("@/lib/ai-robot-task-service")).stopConversationTasks(id);
      await prisma.$transaction([
        prisma.aiRobotTask.deleteMany({ where: { conversationId: id } }),
        prisma.aiRobotMessage.deleteMany({ where: { conversationId: id } }),
        prisma.aiRobotConversation.update({ where: { id }, data: { nextTurn: 0, updatedAt: new Date() } }),
      ]);
      return NextResponse.json({ ok: true });
    });
  } catch (error) { return robotApiErrorResponse(error); }
}
