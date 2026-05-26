import { NextResponse } from "next/server";

import { getBackupJob } from "@/lib/backup-jobs";
import { attachmentContentDisposition } from "@/lib/download-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  const job = getBackupJob(id);
  console.info(`[backup-export:${id}] file request received`);

  if (!job || job.kind !== "backup") {
    console.warn(`[backup-export:${id}] file request missing job`);
    return NextResponse.json({ error: "Backup job not found." }, { status: 404 });
  }

  if (job.status !== "completed" || !job.result) {
    console.warn(`[backup-export:${id}] file request before completion`, {
      status: job.status,
      phase: job.phase,
      processedImages: job.processedImages,
      totalImages: job.totalImages,
    });
    return NextResponse.json({ error: "Backup job is not complete." }, { status: 409 });
  }

  try {
    console.info(`[backup-export:${id}] file response ready`, {
      fileName: job.result.fileName,
      bytes: job.result.buffer.length,
    });

    return new Response(new Uint8Array(job.result.buffer), {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": attachmentContentDisposition(job.result.fileName),
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error(`[backup-export:${id}] file response failed`, {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      fileName: job.result.fileName,
    });
    return NextResponse.json({ error: "Backup file download failed." }, { status: 500 });
  }
}
