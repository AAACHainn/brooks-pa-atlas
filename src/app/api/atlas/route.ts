import { NextResponse } from "next/server";
import type { Prisma } from "@/generated/prisma/client";

import { prisma } from "@/lib/db";
import { findAtlasImagePage } from "@/lib/atlas-images";
import { serializeImageAnnotation } from "@/lib/image-annotations";
import { getIndexTree } from "@/lib/index-tree";
import { navigatorImageWhere } from "@/lib/index-navigator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
  const tagIds = [...new Set(url.searchParams.getAll("tagId").map((tagId) => tagId.trim()).filter(Boolean))];
  const navigatorOptionIds = [
    ...new Set(
      url.searchParams.getAll("navigatorOptionId").map((id) => id.trim()).filter(Boolean),
    ),
  ];
  const requestedPage = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const requestedPageSize = Number(url.searchParams.get("pageSize")) || 50;
  const pageSize = [25, 50, 100, 200].includes(requestedPageSize) ? requestedPageSize : 50;

  const selectedNode = indexId
    ? await prisma.indexNode.findUnique({ where: { id: indexId } })
    : null;

  let navigatorWhere: Prisma.ChartImageWhereInput | null = null;
  try {
    navigatorWhere = await navigatorImageWhere(navigatorOptionIds);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Invalid navigator filter." },
      { status: 400 },
    );
  }

  const imageWhere: Prisma.ChartImageWhereInput = {
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
                { annotations: { some: { text: { contains: query } } } },
              ],
            }
          : {},
        ...tagIds.map((tagId) => ({ tags: { some: { tagId } } })),
        ...(navigatorWhere ? [navigatorWhere] : []),
      ],
  };
  const { images, pagination } = await findAtlasImagePage(imageWhere, requestedPage, pageSize);

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
    images: images.map((image) => ({
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
      annotations: image.annotations.map(serializeImageAnnotation),
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
    pagination,
  });
}
