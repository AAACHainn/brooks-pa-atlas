import { NextResponse } from "next/server";

import { getBackupJob } from "@/lib/backup-jobs";

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

  if (job.status !== "completed" || !job.result) {
    return NextResponse.json({ error: "Backup job is not complete." }, { status: 409 });
  }

  return new Response(new Uint8Array(job.result.buffer), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${job.result.fileName}"`,
      "Cache-Control": "no-store",
    },
  });
}
