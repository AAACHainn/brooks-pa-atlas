import { z } from "zod";
import { controlAiOcrBatch, getAiOcrBatch, previewAiOcrBatch } from "@/lib/ai-ocr-batch-jobs";
import { prisma } from "@/lib/db";
import { aiOcrBatchResponse } from "@/lib/ai-ocr-batch-http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const input = z.strictObject({ action: z.enum(["pause", "resume", "cancel", "retry", "preview_resume", "preview_retry"]), revision: z.number().int().nonnegative(), previewToken: z.string().uuid().optional() });
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid action, revision or preview token." }, { status: 400 });
  const { action, revision, previewToken } = parsed.data;
  return aiOcrBatchResponse(async () => {
    if (action === "preview_resume" || action === "preview_retry") {
      const snapshot = await getAiOcrBatch(id);
      if (snapshot.revision !== revision) return { job: snapshot, error: "任务状态已变化 / Job state changed" };
      const job = await prisma.aiOcrBatchJob.findUniqueOrThrow({ where: { id } });
      return { preview: await previewAiOcrBatch(job.indexNodeId, id, action === "preview_retry" ? "retry" : "resume") };
    }
    return { job: await controlAiOcrBatch(id, action, revision, previewToken) };
  });
}
