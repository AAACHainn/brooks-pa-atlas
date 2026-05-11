import { NextResponse } from "next/server";

import {
  getDocumentImportJob,
  serializeDocumentImportJob,
} from "@/lib/document-import-jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  const job = getDocumentImportJob(id);

  if (!job) {
    return NextResponse.json({ error: "Document import job not found." }, { status: 404 });
  }

  return NextResponse.json({ job: serializeDocumentImportJob(job) });
}
