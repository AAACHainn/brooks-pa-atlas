import { NextResponse } from "next/server";

import { activateKnowledgeVersion } from "@/lib/knowledge-documents";

export const runtime = "nodejs";
export async function POST(_request: Request, context: { params: Promise<{ id: string; versionId: string }> }) {
  try {
    const { id, versionId } = await context.params;
    activateKnowledgeVersion(id, versionId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not activate version." }, { status: 400 });
  }
}
