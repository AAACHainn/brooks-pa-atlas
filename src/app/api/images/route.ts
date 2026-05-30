import { NextResponse } from "next/server";

import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const imageNameCollator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
});

export async function GET(request: Request) {
  const url = new URL(request.url);
  const query = url.searchParams.get("q")?.trim();
  const indexId = url.searchParams.get("indexId")?.trim();
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const pageSize = Math.min(100, Math.max(12, Number(url.searchParams.get("pageSize")) || 48));

  const selectedNode = indexId
    ? await prisma.indexNode.findUnique({ where: { id: indexId } })
    : null;
  const where = {
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
    ],
  };

  const [total, images] = await Promise.all([
    prisma.chartImage.count({ where }),
    prisma.chartImage.findMany({
      where,
      include: { indexNode: true },
      orderBy: [{ originalName: "asc" }, { createdAt: "asc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);
  const sortedImages = [...images].sort((left, right) => {
    const nameComparison = imageNameCollator.compare(left.originalName, right.originalName);
    return nameComparison || left.createdAt.getTime() - right.createdAt.getTime();
  });

  return NextResponse.json({
    page,
    pageSize,
    total,
    images: sortedImages.map((image) => ({
      id: image.id,
      originalName: image.originalName,
      title: image.title,
      width: image.width,
      height: image.height,
      hash: image.hash,
      indexNode: image.indexNode
        ? { id: image.indexNode.id, name: image.indexNode.name, path: image.indexNode.path }
        : null,
    })),
  });
}
