import { NextResponse } from "next/server";

import { backupDownloadResponse, getBackupJob, serializeBackupJob } from "@/lib/backup-jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  const { id } = await context.params;
  if (new URL(request.url).searchParams.has("download")) {
    return backupDownloadResponse(request, id);
  }

  const job = getBackupJob(id);

  if (!job || job.kind !== "backup") {
    return NextResponse.json({ error: "Backup job not found." }, { status: 404 });
  }

  return NextResponse.json({ job: serializeBackupJob(job) });
}

export async function HEAD(request: Request, context: RouteContext) {
  const { id } = await context.params;
  return backupDownloadResponse(request, id, true);
}
