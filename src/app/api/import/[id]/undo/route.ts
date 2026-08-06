import { unlink } from "node:fs/promises";

import { NextResponse } from "next/server";

import { prisma } from "@/lib/db";
import { absoluteImagePath } from "@/lib/storage";
import { cleanupUnusedTags } from "@/lib/tags";
import { removeThumbnail } from "@/lib/thumbnails";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  context: RouteContext<"/api/import/[id]/undo">,
) {
  const { id } = await context.params;
  const batch = await prisma.importBatch.findUnique({
    where: { id },
    include: {
      images: {
        select: {
          id: true,
          hash: true,
          libraryPath: true,
        },
      },
    },
  });

  if (!batch) {
    return NextResponse.json({ error: "Import batch not found." }, { status: 404 });
  }

  const examQuestionCount = await prisma.examQuestion.count({
    where: { chartImageId: { in: batch.images.map((image) => image.id) } },
  });
  if (examQuestionCount > 0) {
    return NextResponse.json(
      { error: "Some imported images are used by exam questions and cannot be deleted." },
      { status: 409 },
    );
  }

  for (const image of batch.images) {
    try {
      await unlink(absoluteImagePath(image.libraryPath));
    } catch (error) {
      const code = error instanceof Error && "code" in error ? error.code : null;
      if (code !== "ENOENT") {
        return NextResponse.json(
          { error: `Failed to remove ${image.libraryPath}.` },
          { status: 500 },
        );
      }
    }
  }

  for (const image of batch.images) {
    await removeThumbnail(image.hash).catch((error) => {
      console.error(`[undo-import:${batch.id}] thumbnail removal failed`, {
        imageId: image.id,
        error,
      });
    });
  }

  await prisma.$transaction(async (tx) => {
    await tx.importItem.deleteMany({ where: { batchId: batch.id } });
    await tx.chartImage.deleteMany({ where: { importBatchId: batch.id } });
    await tx.importBatch.delete({ where: { id: batch.id } });
    await cleanupUnusedTags(tx);
  });

  return NextResponse.json({ ok: true, removedCount: batch.images.length });
}
