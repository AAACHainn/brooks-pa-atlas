import { NextResponse } from "next/server";

import { getBackupJob, serializeBackupJob } from "@/lib/backup-jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  const job = getBackupJob(id);

  if (!job || job.kind !== "backup") {
    return NextResponse.json({ error: "Backup job not found." }, { status: 404 });
  }

  return NextResponse.json({ job: serializeBackupJob(job) });
}
