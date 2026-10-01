import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/db";
import { deleteKnowledgeDocument, updateKnowledgeDocument } from "@/lib/knowledge-documents";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  indexNodeId: z.string().min(1).nullable().optional(),
  enabled: z.boolean().optional(),
});

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid document update." }, { status: 400 });
  try {
    let indexPathSnapshot: string | undefined;
    if (parsed.data.indexNodeId) {
      const node = await prisma.indexNode.findUnique({ where: { id: parsed.data.indexNodeId }, select: { path: true } });
      if (!node) return NextResponse.json({ error: "Target index node not found." }, { status: 404 });
      indexPathSnapshot = node.path;
    }
    const document = updateKnowledgeDocument((await context.params).id, { ...parsed.data, indexPathSnapshot });
    return NextResponse.json({ document });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not update knowledge document." }, { status: 400 });
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await deleteKnowledgeDocument((await context.params).id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not delete knowledge document." }, { status: 400 });
  }
}
