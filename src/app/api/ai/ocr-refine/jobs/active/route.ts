import { activeAiOcrBatch } from "@/lib/ai-ocr-batch-jobs";
import { aiOcrBatchResponse } from "@/lib/ai-ocr-batch-http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() { return aiOcrBatchResponse(async () => ({ job: await activeAiOcrBatch() })); }
