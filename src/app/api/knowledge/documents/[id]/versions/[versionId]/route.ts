import { NextResponse } from "next/server";

import { deleteKnowledgeVersion } from "@/lib/knowledge-documents";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string; versionId: string }> },
) {
  try {
    const { id, versionId } = await context.params;
    return NextResponse.json(await deleteKnowledgeVersion(id, versionId));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not delete knowledge version." },
      { status: 400 },
    );
  }
}
