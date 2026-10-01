import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/db";
import { retrieveKnowledgeContext } from "@/lib/knowledge-search";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  query: z.string().trim().min(1).max(20_000),
  imageId: z.string().min(1).optional(),
  indexNodeId: z.string().min(1).nullable().optional(),
});

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "A search query is required." }, { status: 400 });
  try {
    let indexNodeId = parsed.data.indexNodeId ?? null;
    if (parsed.data.imageId) {
      const image = await prisma.chartImage.findUnique({ where: { id: parsed.data.imageId }, select: { indexNodeId: true } });
      indexNodeId = image?.indexNodeId ?? null;
    }
    return NextResponse.json({ result: await retrieveKnowledgeContext({ query: parsed.data.query, indexNodeId }) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Knowledge search failed." }, { status: 502 });
  }
}
