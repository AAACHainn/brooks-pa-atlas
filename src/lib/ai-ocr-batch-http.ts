import { AiOcrBatchError } from "@/lib/ai-ocr-batch-jobs";
import { HeavyTaskBusyError } from "@/lib/background-task-coordinator";
export async function aiOcrBatchResponse(work: () => Promise<unknown>, status = 200) {
  try { return Response.json(await work(), { status }); }
  catch (error) {
    if (error instanceof AiOcrBatchError || error instanceof HeavyTaskBusyError) return Response.json({ error: error.message }, { status: error instanceof AiOcrBatchError ? error.status : 409 });
    return Response.json({ error: "任务存储不可用，请检查数据库迁移。 / Job storage unavailable; check database migrations." }, { status: 503 });
  }
}
