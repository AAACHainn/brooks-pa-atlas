import type { IndexNode } from "@/generated/prisma/client";

import { prisma } from "@/lib/db";

export type IndexTreeNode = {
  id: string;
  name: string;
  parentId: string | null;
  depth: number;
  path: string;
  sortOrder: number;
  imageCount: number;
  children: IndexTreeNode[];
};

function normalizeSegment(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function makePath(parentPath: string | null | undefined, name: string) {
  return parentPath ? `${parentPath} / ${name}` : name;
}

export async function createIndexNode(name: string, parentId?: string | null) {
  const cleanName = normalizeSegment(name);

  if (!cleanName) {
    throw new Error("Index name is required.");
  }

  const parent = parentId
    ? await prisma.indexNode.findUnique({ where: { id: parentId } })
    : null;

  const siblingCount = await prisma.indexNode.count({
    where: { parentId: parent?.id ?? null },
  });

  return prisma.indexNode.create({
    data: {
      name: cleanName,
      parentId: parent?.id ?? null,
      depth: parent ? parent.depth + 1 : 0,
      path: makePath(parent?.path, cleanName),
      sortOrder: siblingCount,
    },
  });
}

export async function ensureIndexPath(segments: string[]) {
  let parentId: string | null = null;
  let parentPath: string | null = null;
  let depth = 0;
  let current: IndexNode | null = null;

  for (const rawSegment of segments) {
    const name = normalizeSegment(rawSegment);
    if (!name) {
      continue;
    }

    current = await prisma.indexNode.findFirst({
      where: { parentId, name },
    });

    if (!current) {
      const siblingCount: number = await prisma.indexNode.count({ where: { parentId } });
      current = await prisma.indexNode.create({
        data: {
          name,
          parentId,
          depth,
          path: makePath(parentPath, name),
          sortOrder: siblingCount,
        },
      });
    }

    parentId = current.id;
    parentPath = current.path;
    depth = current.depth + 1;
  }

  return current;
}

export async function getIndexTree() {
  const [nodes, groupedImages] = await Promise.all([
    prisma.indexNode.findMany({
      orderBy: [{ depth: "asc" }, { sortOrder: "asc" }, { name: "asc" }],
    }),
    prisma.chartImage.groupBy({
      by: ["indexNodeId"],
      _count: { _all: true },
      where: { indexNodeId: { not: null } },
    }),
  ]);

  const directCounts = new Map(
    groupedImages.map((item) => [item.indexNodeId, item._count._all]),
  );

  const map = new Map<string, IndexTreeNode>();
  const roots: IndexTreeNode[] = [];

  for (const node of nodes) {
    map.set(node.id, {
      id: node.id,
      name: node.name,
      parentId: node.parentId,
      depth: node.depth,
      path: node.path,
      sortOrder: node.sortOrder,
      imageCount: directCounts.get(node.id) ?? 0,
      children: [],
    });
  }

  for (const node of map.values()) {
    if (node.parentId && map.has(node.parentId)) {
      map.get(node.parentId)?.children.push(node);
    } else {
      roots.push(node);
    }
  }

  const aggregateImageCounts = (node: IndexTreeNode): number => {
    const total = node.children.reduce(
      (sum, child) => sum + aggregateImageCounts(child),
      node.imageCount,
    );
    node.imageCount = total;
    return total;
  };

  roots.forEach(aggregateImageCounts);

  return roots;
}
