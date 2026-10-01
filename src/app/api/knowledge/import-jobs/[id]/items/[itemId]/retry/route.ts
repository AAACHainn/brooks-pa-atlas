import { NextResponse } from "next/server";
import { decideKnowledgeImportItem } from "@/lib/knowledge-import-jobs";

export const runtime = "nodejs";
export async function POST(_request: Request, context: { params: Promise<{ itemId: string }> }) {
  try { return NextResponse.json({ job: decideKnowledgeImportItem((await context.params).itemId, "retry") }, { status: 202 }); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Retry failed." }, { status: 400 }); }
}
