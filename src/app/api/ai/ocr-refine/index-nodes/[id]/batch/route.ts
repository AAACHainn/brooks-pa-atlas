import { z } from "zod";
import { previewAiOcrBatch, startAiOcrBatch } from "@/lib/ai-ocr-batch-jobs";
import { aiOcrBatchResponse } from "@/lib/ai-ocr-batch-http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const input = z.strictObject({ mode: z.enum(["missing", "all"]), previewToken: z.string().uuid() });
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return aiOcrBatchResponse(() => previewAiOcrBatch(id));
}
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid mode or preview token." }, { status: 400 });
  return aiOcrBatchResponse(async () => ({ job: await startAiOcrBatch(id, parsed.data.mode, parsed.data.previewToken) }), 202);
}
