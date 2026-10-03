import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/db";
import {
  deleteKnowledgeDocumentBinding,
  KnowledgeBindingConflictError,
  patchKnowledgeDocumentBinding,
  putKnowledgeDocumentBinding,
} from "@/lib/knowledge-documents";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const putSchema = z.object({
  indexNodeId: z.string().min(1),
  appliesToDescendants: z.boolean().default(true),
});
const patchSchema = z.object({ appliesToDescendants: z.boolean() });

export async function PUT(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const parsed = putSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid knowledge binding." }, { status: 400 });
  const node = await prisma.indexNode.findUnique({
    where: { id: parsed.data.indexNodeId },
    select: { id: true, path: true },
  });
  if (!node) return NextResponse.json({ error: "Target index node not found." }, { status: 404 });
  try {
    return NextResponse.json({ binding: putKnowledgeDocumentBinding((await context.params).id, {
      indexNodeId: node.id,
      indexPathSnapshot: node.path,
      appliesToDescendants: parsed.data.appliesToDescendants,
    }) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not update knowledge binding." },
      { status: error instanceof KnowledgeBindingConflictError ? 409 : 400 },
    );
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid knowledge binding update." }, { status: 400 });
  try {
    return NextResponse.json({
      binding: patchKnowledgeDocumentBinding((await context.params).id, parsed.data.appliesToDescendants),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not update knowledge binding." },
      { status: 400 },
    );
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    return NextResponse.json(deleteKnowledgeDocumentBinding((await context.params).id));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not remove knowledge binding." },
      { status: 400 },
    );
  }
}
