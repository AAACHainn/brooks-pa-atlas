import path from "node:path";

import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  fileNames: z.array(z.string().min(1)).min(1).max(200),
  rootIndexNodeId: z.string().min(1),
});

function normalized(value: string) {
  return value.normalize("NFKC").toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid mapping request." }, { status: 400 });
  const nodes = await prisma.indexNode.findMany({ select: { id: true, name: true, path: true, parentId: true } });
  const root = nodes.find((node) => node.id === parsed.data.rootIndexNodeId);
  if (!root) return NextResponse.json({ error: "Course root node not found." }, { status: 404 });
  const descendants = nodes.filter((node) => node.id === root.id || node.path.startsWith(`${root.path} / `));
  const mappings = parsed.data.fileNames.map((fileName) => {
    const stem = path.basename(fileName, path.extname(fileName));
    const key = normalized(stem);
    const exact = descendants.filter((node) => normalized(node.name) === key);
    const fuzzy = exact.length ? [] : descendants.filter((node) => {
      const candidate = normalized(node.name);
      return candidate.includes(key) || key.includes(candidate);
    }).slice(0, 10);
    const candidates = exact.length ? exact : fuzzy;
    return {
      fileName,
      status: exact.length === 1 ? "EXACT" : candidates.length === 0 ? "UNMATCHED" : candidates.length === 1 ? "FUZZY" : "AMBIGUOUS",
      selectedIndexNodeId: exact.length === 1 ? exact[0].id : null,
      candidates,
    };
  });
  return NextResponse.json({ mappings });
}
