import { NextResponse } from "next/server";

import { knowledgeImportJobSnapshot, startKnowledgeImportJob } from "@/lib/knowledge-import-jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const job = knowledgeImportJobSnapshot(id);
  if (!job) return NextResponse.json({ error: "Knowledge import job not found." }, { status: 404 });
  if (job.status === "RUNNING") startKnowledgeImportJob(id);
  return NextResponse.json({ job });
}
