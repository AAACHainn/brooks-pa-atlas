import { NextResponse } from "next/server";

import { prisma } from "@/lib/db";
import { getIndexTree } from "@/lib/index-tree";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const imageNameCollator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
});

function snippet(value: string | null | undefined, length = 180) {
  if (!value) {
    return null;
  }

  return value.length > length ? `${value.slice(0, length)}...` : value;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const query = url.searchParams.get("q")?.trim();
  const indexId = url.searchParams.get("indexId")?.trim();
  const tagId = url.searchParams.get("tagId")?.trim();

  const selectedNode = indexId
    ? await prisma.indexNode.findUnique({ where: { id: indexId } })
    : null;

  const images = await prisma.chartImage.findMany({
    where: {
      AND: [
        selectedNode
          ? {
              OR: [
                { indexNodeId: selectedNode.id },
                { indexNode: { path: { startsWith: `${selectedNode.path} /` } } },
              ],
            }
          : {},
        query
          ? {
              OR: [
                { originalName: { contains: query } },
                { title: { contains: query } },
                { notes: { contains: query } },
                { ocrText: { contains: query } },
                { indexNode: { path: { contains: query } } },
                { tags: { some: { tag: { name: { contains: query } } } } },
              ],
            }
          : {},
        tagId ? { tags: { some: { tagId } } } : {},
      ],
    },
    orderBy: [{ originalName: "asc" }, { createdAt: "asc" }],
    take: 200,
    include: { indexNode: true, tags: { include: { tag: true } } },
  });
  const sortedImages = [...images].sort((left, right) => {
    const nameComparison = imageNameCollator.compare(left.originalName, right.originalName);
    if (nameComparison !== 0) {
      return nameComparison;
    }

    return left.createdAt.getTime() - right.createdAt.getTime();
  });

  const [tree, batches, stats, tags] = await Promise.all([
    getIndexTree(),
    prisma.importBatch.findMany({
      orderBy: { createdAt: "desc" },
      take: 8,
      include: {
        items: {
          where: { status: "FAILED" },
          take: 3,
          orderBy: { createdAt: "desc" },
        },
      },
    }),
    prisma.chartImage.groupBy({
      by: ["ocrStatus"],
      _count: { _all: true },
    }),
    prisma.tag.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);

  return NextResponse.json({
    tree,
    batches,
    tags,
    images: sortedImages.map((image) => ({
      id: image.id,
      originalName: image.originalName,
      title: image.title,
      notes: image.notes,
      libraryPath: image.libraryPath,
      mimeType: image.mimeType,
      sizeBytes: image.sizeBytes,
      width: image.width,
      height: image.height,
      hash: image.hash,
      ocrStatus: image.ocrStatus,
      ocrText: snippet(image.ocrText),
      ocrError: snippet(image.ocrError, 120),
      createdAt: image.createdAt,
      tags: image.tags
        .map((item) => item.tag)
        .sort((left, right) => left.name.localeCompare(right.name)),
      indexNode: image.indexNode
        ? {
            id: image.indexNode.id,
            name: image.indexNode.name,
            path: image.indexNode.path,
          }
        : null,
    })),
    stats: {
      imageCount: await prisma.chartImage.count(),
      unclassifiedCount: await prisma.chartImage.count({ where: { indexNodeId: null } }),
      ocr: Object.fromEntries(stats.map((item) => [item.ocrStatus, item._count._all])),
    },
  });
}
