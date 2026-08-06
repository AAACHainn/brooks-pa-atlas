import { NextResponse } from "next/server";

import {
  getLatestThumbnailJob,
  serializeThumbnailJob,
  startThumbnailJob,
} from "@/lib/thumbnail-jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const job = await getLatestThumbnailJob();
  return NextResponse.json({ job: job ? serializeThumbnailJob(job) : null });
}

export async function POST() {
  try {
    const { job, reused } = await startThumbnailJob();
    return NextResponse.json(
      { job: serializeThumbnailJob(job), reused },
      { status: reused ? 200 : 202 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to start thumbnail job.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
