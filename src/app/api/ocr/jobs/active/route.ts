import { NextResponse } from "next/server";

import { getActiveOcrBatchJob, serializeOcrBatchJob } from "@/lib/ocr-batch-jobs";
import { resumeActiveOcrBatchJob } from "@/lib/ocr-queue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  await resumeActiveOcrBatchJob();
  const job = await getActiveOcrBatchJob();
  return NextResponse.json({ job: job ? serializeOcrBatchJob(job) : null });
}
