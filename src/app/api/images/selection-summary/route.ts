import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const parsed = z
    .object({ imageIds: z.array(z.string().min(1)).min(1).max(1000) })
    .safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Between 1 and 1000 image ids are required." }, { status: 400 });
  }

  const imageIds = [...new Set(parsed.data.imageIds)];
  const [imageCount, tagGroups] = await Promise.all([
    prisma.chartImage.count({ where: { id: { in: imageIds } } }),
    prisma.chartImageTag.groupBy({
      by: ["tagId"],
      where: { chartImageId: { in: imageIds } },
      _count: { _all: true },
    }),
  ]);
  if (imageCount !== imageIds.length) {
    return NextResponse.json({ error: "One or more images were not found." }, { status: 404 });
  }
  const tags = await prisma.tag.findMany({
    where: { id: { in: tagGroups.map((group) => group.tagId) } },
    orderBy: { name: "asc" },
  });
  const counts = new Map(tagGroups.map((group) => [group.tagId, group._count._all]));
  return NextResponse.json({
    tags: tags.map((tag) => ({ id: tag.id, name: tag.name, count: counts.get(tag.id) ?? 0 })),
  });
}
