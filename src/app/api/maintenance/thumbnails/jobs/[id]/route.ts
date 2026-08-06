import { NextResponse } from "next/server";

import { getThumbnailJob, serializeThumbnailJob } from "@/lib/thumbnail-jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: RouteContext<"/api/maintenance/thumbnails/jobs/[id]">,
) {
  const { id } = await context.params;
  try {
    const job = await getThumbnailJob(id);
    if (!job) {
      return NextResponse.json({ error: "Thumbnail job not found." }, { status: 404 });
    }
    return NextResponse.json({ job: serializeThumbnailJob(job) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to read thumbnail job.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
