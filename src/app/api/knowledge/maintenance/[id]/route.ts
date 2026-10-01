import { NextResponse } from "next/server";

import { maintenanceSnapshot, startMaintenanceJob } from "@/lib/knowledge-maintenance";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const job = maintenanceSnapshot(id);
  if (!job) return NextResponse.json({ error: "Maintenance job not found." }, { status: 404 });
  if (job.status === "RUNNING") startMaintenanceJob(id);
  return NextResponse.json({ job });
}
