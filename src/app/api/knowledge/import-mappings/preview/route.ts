import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/db";
import { previewKnowledgeImportMappings } from "@/lib/knowledge-import-mapping";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  fileNames: z.array(z.string().min(1)).min(1).max(200),
  rootIndexNodeId: z.string().min(1),
});

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid mapping request." }, { status: 400 });
  const nodes = await prisma.indexNode.findMany({ select: { id: true, name: true, path: true, parentId: true } });
  const root = nodes.find((node) => node.id === parsed.data.rootIndexNodeId);
  if (!root) return NextResponse.json({ error: "Course root node not found." }, { status: 404 });
  const descendants = nodes.filter((node) => node.id === root.id || node.path.startsWith(`${root.path} / `));
  const mappings = previewKnowledgeImportMappings(parsed.data.fileNames, descendants);
  return NextResponse.json({ mappings });
}
