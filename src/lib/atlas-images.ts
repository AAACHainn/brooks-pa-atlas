import type { Prisma } from "@/generated/prisma/client";

import { prisma } from "@/lib/db";

const imageNameCollator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
});

export async function findAtlasImagePage(
  where: Prisma.ChartImageWhereInput,
  page: number,
  pageSize: number,
) {
  const lightweight = await prisma.chartImage.findMany({
    where,
    select: { id: true, originalName: true, createdAt: true },
  });
  lightweight.sort((left, right) => {
    const nameComparison = imageNameCollator.compare(left.originalName, right.originalName);
    return nameComparison || left.createdAt.getTime() - right.createdAt.getTime();
  });

  const total = lightweight.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const currentPage = Math.min(Math.max(1, page), totalPages);
  const pageIds = lightweight
    .slice((currentPage - 1) * pageSize, currentPage * pageSize)
    .map((image) => image.id);
  const images = pageIds.length
    ? await prisma.chartImage.findMany({
        where: { id: { in: pageIds } },
        include: {
          indexNode: true,
          tags: { include: { tag: true } },
          annotations: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] },
        },
      })
    : [];
  const imageById = new Map(images.map((image) => [image.id, image]));

  return {
    images: pageIds.flatMap((id) => {
      const image = imageById.get(id);
      return image ? [image] : [];
    }),
    pagination: { page: currentPage, pageSize, total, totalPages },
  };
}
