import { NextResponse } from "next/server";

import { getOcrBatchJob, serializeOcrBatchJob } from "@/lib/ocr-batch-jobs";
import { resumeActiveOcrBatchJob } from "@/lib/ocr-queue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: RouteContext<"/api/ocr/jobs/[id]">,
) {
  await resumeActiveOcrBatchJob();
  const { id } = await context.params;
  const job = await getOcrBatchJob(id);
  if (!job) {
    return NextResponse.json({ error: "Batch OCR task not found." }, { status: 404 });
  }
  return NextResponse.json({ job: serializeOcrBatchJob(job) });
}
