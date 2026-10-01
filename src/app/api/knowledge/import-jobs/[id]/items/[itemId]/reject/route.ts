import { NextResponse } from "next/server";
import { decideKnowledgeImportItem } from "@/lib/knowledge-import-jobs";

export const runtime = "nodejs";
export async function POST(_request: Request, context: { params: Promise<{ itemId: string }> }) {
  try { return NextResponse.json({ job: decideKnowledgeImportItem((await context.params).itemId, "reject") }); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Reject failed." }, { status: 400 }); }
}
