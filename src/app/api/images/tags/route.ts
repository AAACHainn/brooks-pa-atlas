import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/db";
import { cleanupUnusedTags, connectImageTags, ensureTags } from "@/lib/tags";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requestSchema = z.object({
  imageIds: z.array(z.string().min(1)).min(1).max(1000),
  addTagNames: z.array(z.string()).max(100).default([]),
  removeTagIds: z.array(z.string().min(1)).max(100).default([]),
});

export async function PATCH(request: Request) {
  const parsed = requestSchema.safeParse(await request.json());

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid tag update request." }, { status: 400 });
  }

  const imageIds = [...new Set(parsed.data.imageIds)];
  const removeTagIds = [...new Set(parsed.data.removeTagIds)];
  const imageCount = await prisma.chartImage.count({ where: { id: { in: imageIds } } });

  if (imageCount !== imageIds.length) {
    return NextResponse.json({ error: "Some images were not found." }, { status: 404 });
  }

  const tags = await prisma.$transaction(async (tx) => {
    const addedTags = await ensureTags(tx, parsed.data.addTagNames);

    if (addedTags.length > 0) {
      await connectImageTags(tx, imageIds, addedTags);
    }

    if (removeTagIds.length > 0) {
      await tx.chartImageTag.deleteMany({
        where: {
          chartImageId: { in: imageIds },
          tagId: { in: removeTagIds },
        },
      });
    }

    await cleanupUnusedTags(tx);
    return addedTags;
  });

  return NextResponse.json({ ok: true, tags });
}
