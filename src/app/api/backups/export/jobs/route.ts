import { NextResponse } from "next/server";

import { serializeBackupJob, startBackupJob } from "@/lib/backup-jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const url = new URL(request.url);
  const indexId = url.searchParams.get("indexId");
  const job = startBackupJob({ indexId });
  return NextResponse.json({ job: serializeBackupJob(job) });
}
