import { getAiOcrBatch } from "@/lib/ai-ocr-batch-jobs";
import { aiOcrBatchResponse } from "@/lib/ai-ocr-batch-http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return aiOcrBatchResponse(async () => ({ job: await getAiOcrBatch(id) }));
}
