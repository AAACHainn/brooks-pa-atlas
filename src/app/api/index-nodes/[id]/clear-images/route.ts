import { unlink } from "node:fs/promises";

import { NextResponse } from "next/server";

import { prisma } from "@/lib/db";
import { absoluteImagePath } from "@/lib/storage";
import { cleanupUnusedTags } from "@/lib/tags";
import { removeThumbnail } from "@/lib/thumbnails";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requiredConfirmation = "确认删除";
const prismaChunkSize = 500;

function chunkArray<T>(items: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
}

export async function POST(
  request: Request,
  context: RouteContext<"/api/index-nodes/[id]/clear-images">,
) {
  const { id } = await context.params;
  const body = (await request.json()) as {
    confirmation?: string;
  };

  if (body.confirmation !== requiredConfirmation) {
    return NextResponse.json(
      { error: "Confirmation phrase is required." },
      { status: 400 },
    );
  }

  const node = await prisma.indexNode.findUnique({ where: { id } });
  if (!node) {
    return NextResponse.json({ error: "Index node not found." }, { status: 404 });
  }

  const descendants = await prisma.indexNode.findMany({
    where: { path: { startsWith: `${node.path} /` } },
    select: { id: true },
  });
  const nodeIds = [node.id, ...descendants.map((descendant) => descendant.id)];
  const images = await prisma.chartImage.findMany({
    where: { indexNodeId: { in: nodeIds } },
    select: { id: true, hash: true, libraryPath: true },
  });
  const imageIds = images.map((image) => image.id);
  let examQuestionCount = 0;

  for (const imageIdChunk of chunkArray(imageIds, prismaChunkSize)) {
    examQuestionCount += await prisma.examQuestion.count({
      where: { chartImageId: { in: imageIdChunk } },
    });
    if (examQuestionCount > 0) {
      break;
    }
  }

  if (examQuestionCount > 0) {
    return NextResponse.json(
      { error: "Some images are used by exam questions and cannot be deleted." },
      { status: 409 },
    );
  }

  for (const image of images) {
    try {
      await unlink(absoluteImagePath(image.libraryPath));
    } catch (error) {
      const code = error instanceof Error && "code" in error ? error.code : null;
      if (code !== "ENOENT") {
        console.error("[clear-index-images] file removal failed", {
          indexNodeId: node.id,
          imageId: image.id,
          libraryPath: image.libraryPath,
          error,
        });
        return NextResponse.json(
          { error: `Failed to remove ${image.libraryPath}.` },
          { status: 500 },
        );
      }
    }
  }

  for (const image of images) {
    await removeThumbnail(image.hash).catch((error) => {
      console.error("[clear-index-images] thumbnail removal failed", {
        indexNodeId: node.id,
        imageId: image.id,
        error,
      });
    });
  }

  await prisma.$transaction(async (tx) => {
    for (const imageIdChunk of chunkArray(imageIds, prismaChunkSize)) {
      await tx.chartImage.deleteMany({
        where: { id: { in: imageIdChunk } },
      });
    }
    await cleanupUnusedTags(tx);
  });

  return NextResponse.json({ ok: true, removedCount: images.length });
}
