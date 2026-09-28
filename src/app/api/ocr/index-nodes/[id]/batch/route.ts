import { NextResponse } from "next/server";

import {
  getActiveOcrBatchJob,
  getIndexOcrBatchSummary,
  OcrBatchJobRequestError,
  serializeOcrBatchJob,
  startIndexOcrBatchJob,
} from "@/lib/ocr-batch-jobs";
import { scheduleOcrPump } from "@/lib/ocr-queue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isUniqueConstraintError(error: unknown) {
  return Boolean(
    error &&
    typeof error === "object" &&
    "code" in error &&
    error.code === "P2002",
  );
}

function errorResponse(error: unknown) {
  if (error instanceof OcrBatchJobRequestError) {
    return NextResponse.json(
      { error: error.message, code: error.code },
      { status: error.status },
    );
  }
  console.error("[ocr-batch] request failed", error);
  return NextResponse.json({ error: "Batch OCR request failed." }, { status: 500 });
}

export async function GET(
  _request: Request,
  context: RouteContext<"/api/ocr/index-nodes/[id]/batch">,
) {
  try {
    const { id } = await context.params;
    const summary = await getIndexOcrBatchSummary(id);
    return NextResponse.json({ summary });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(
  request: Request,
  context: RouteContext<"/api/ocr/index-nodes/[id]/batch">,
) {
  try {
    const { id } = await context.params;
    const body = (await request.json().catch(() => ({}))) as { confirmation?: string };
    const job = await startIndexOcrBatchJob(id, body.confirmation);
    scheduleOcrPump();
    return NextResponse.json({ job: serializeOcrBatchJob(job) }, { status: 202 });
  } catch (error) {
    if (
      (error instanceof OcrBatchJobRequestError && error.code === "ACTIVE_JOB_EXISTS") ||
      isUniqueConstraintError(error)
    ) {
      const activeJob = await getActiveOcrBatchJob();
      return NextResponse.json(
        {
          error: "Another batch OCR task is already running.",
          code: "ACTIVE_JOB_EXISTS",
          job: activeJob ? serializeOcrBatchJob(activeJob) : null,
        },
        { status: 409 },
      );
    }
    return errorResponse(error);
  }
}
