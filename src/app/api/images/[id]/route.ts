import { unlink } from "node:fs/promises";

import { NextResponse } from "next/server";

import { prisma } from "@/lib/db";
import { updateBatchCounters } from "@/lib/ocr-queue";
import { absoluteImagePath } from "@/lib/storage";
import { cleanupUnusedTags, replaceImageTags } from "@/lib/tags";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ImageWithTags = NonNullable<Awaited<ReturnType<typeof prisma.chartImage.findUnique>>> & {
  tags: { tag: { id: string; name: string; normalizedName: string; createdAt: Date; updatedAt: Date } }[];
};

function serializeImage(image: ImageWithTags) {
  return {
    ...image,
    tags: image.tags
      .map((item) => item.tag)
      .sort((left, right) => left.name.localeCompare(right.name)),
  };
}

export async function GET(
  _request: Request,
  context: RouteContext<"/api/images/[id]">,
) {
  const { id } = await context.params;
  const image = await prisma.chartImage.findUnique({
    where: { id },
    include: { indexNode: true, tags: { include: { tag: true } } },
  });

  if (!image) {
    return NextResponse.json({ error: "Image not found." }, { status: 404 });
  }

  return NextResponse.json({ image: serializeImage(image) });
}

export async function PATCH(
  request: Request,
  context: RouteContext<"/api/images/[id]">,
) {
  const { id } = await context.params;
  const body = (await request.json()) as {
    title?: string | null;
    notes?: string | null;
    indexNodeId?: string | null;
    ocrText?: string | null;
    tagNames?: string[];
  };
  const hasOcrText = Object.prototype.hasOwnProperty.call(body, "ocrText");
  const ocrText = typeof body.ocrText === "string" && body.ocrText.trim() ? body.ocrText : null;

  const image = await prisma.$transaction(async (tx) => {
    await tx.chartImage.update({
      where: { id },
      data: {
        title: body.title ?? null,
        notes: body.notes ?? null,
        indexNodeId: body.indexNodeId || null,
        ...(hasOcrText
          ? {
              ocrText,
              ocrStatus: ocrText ? "COMPLETED" : "SKIPPED",
              ocrError: null,
              ocrUpdatedAt: new Date(),
            }
          : {}),
      },
    });

    if (Array.isArray(body.tagNames)) {
      await replaceImageTags(tx, id, body.tagNames);
    }

    return tx.chartImage.findUniqueOrThrow({
      where: { id },
      include: { indexNode: true, tags: { include: { tag: true } } },
    });
  });

  if (hasOcrText && image.importBatchId) {
    await updateBatchCounters(image.importBatchId);
  }

  return NextResponse.json({
    image: serializeImage(image),
  });
}

export async function DELETE(
  _request: Request,
  context: RouteContext<"/api/images/[id]">,
) {
  const { id } = await context.params;
  const image = await prisma.chartImage.findUnique({
    where: { id },
    select: { id: true, libraryPath: true },
  });

  if (!image) {
    return NextResponse.json({ error: "Image not found." }, { status: 404 });
  }

  const examQuestionCount = await prisma.examQuestion.count({
    where: { chartImageId: image.id },
  });
  if (examQuestionCount > 0) {
    return NextResponse.json(
      { error: "This image is used by exam questions and cannot be deleted." },
      { status: 409 },
    );
  }

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

  await prisma.$transaction(async (tx) => {
    await tx.chartImage.delete({ where: { id: image.id } });
    await cleanupUnusedTags(tx);
  });

  return NextResponse.json({ ok: true });
}
