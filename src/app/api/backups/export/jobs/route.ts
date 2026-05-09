import { NextResponse } from "next/server";

import { serializeBackupJob, startBackupJob } from "@/lib/backup-jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const job = startBackupJob();
  return NextResponse.json({ job: serializeBackupJob(job) });
}
