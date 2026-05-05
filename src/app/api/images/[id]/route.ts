import { NextResponse } from "next/server";

import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  context: RouteContext<"/api/images/[id]">,
) {
  const { id } = await context.params;
  const body = (await request.json()) as {
    title?: string | null;
    notes?: string | null;
    indexNodeId?: string | null;
  };

  const image = await prisma.chartImage.update({
    where: { id },
    data: {
      title: body.title ?? null,
      notes: body.notes ?? null,
      indexNodeId: body.indexNodeId || null,
    },
    include: { indexNode: true },
  });

  return NextResponse.json({ image });
}
