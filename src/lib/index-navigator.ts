import type { Prisma } from "@/generated/prisma/client";

import { prisma } from "@/lib/db";
import { getIndexTree, type IndexTreeNode } from "@/lib/index-tree";

const nodeCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

export function normalizeNavigatorName(value: string) {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

export function cleanNavigatorName(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

export async function getNavigatorCatalog() {
  const categories = await prisma.indexNavigatorCategory.findMany({
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    include: {
      options: {
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        include: { _count: { select: { nodeAssignments: true } } },
      },
    },
  });

  return categories.map((category) => ({
    id: category.id,
    name: category.name,
    sortOrder: category.sortOrder,
    assignmentCount: category.options.reduce(
      (total, option) => total + option._count.nodeAssignments,
      0,
    ),
    options: category.options.map((option) => ({
      id: option.id,
      categoryId: option.categoryId,
      name: option.name,
      sortOrder: option.sortOrder,
      assignmentCount: option._count.nodeAssignments,
    })),
  }));
}

async function selectedOptionGroups(optionIds: string[]) {
  const uniqueIds = [...new Set(optionIds.filter(Boolean))];
  if (uniqueIds.length === 0) {
    return { optionIds: uniqueIds, groups: [] as string[][] };
  }

  const options = await prisma.indexNavigatorOption.findMany({
    where: { id: { in: uniqueIds } },
    select: { id: true, categoryId: true },
  });
  if (options.length !== uniqueIds.length) {
    throw new Error("One or more navigator options were not found.");
  }

  const grouped = new Map<string, string[]>();
  for (const option of options) {
    const values = grouped.get(option.categoryId) ?? [];
    values.push(option.id);
    grouped.set(option.categoryId, values);
  }

  return { optionIds: uniqueIds, groups: [...grouped.values()] };
}

export async function findMatchedNavigatorNodes(optionIds: string[], nodeQuery = "") {
  const { groups } = await selectedOptionGroups(optionIds);
  const cleanQuery = nodeQuery.trim();

  if (groups.length === 0 && !cleanQuery) {
    return [];
  }

  return prisma.indexNode.findMany({
    where: {
      AND: [
        ...groups.map((group) => ({
          navigatorOptions: { some: { optionId: { in: group } } },
        })),
        cleanQuery
          ? {
              OR: [
                { name: { contains: cleanQuery } },
                { path: { contains: cleanQuery } },
              ],
            }
          : {},
      ],
    },
    orderBy: [{ depth: "asc" }, { sortOrder: "asc" }, { name: "asc" }],
  });
}

function flattenTree(nodes: IndexTreeNode[]): IndexTreeNode[] {
  return nodes.flatMap((node) => [node, ...flattenTree(node.children)]);
}

export async function getNavigatorResults(
  optionIds: string[],
  nodeQuery: string,
  page: number,
  pageSize: number,
) {
  const [nodes, tree] = await Promise.all([
    findMatchedNavigatorNodes(optionIds, nodeQuery),
    getIndexTree(),
  ]);
  const imageCountById = new Map(flattenTree(tree).map((node) => [node.id, node.imageCount]));
  const sorted = [...nodes].sort((left, right) => nodeCollator.compare(left.path, right.path));
  const total = sorted.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const currentPage = Math.min(Math.max(1, page), totalPages);
  const start = (currentPage - 1) * pageSize;

  return {
    results: sorted.slice(start, start + pageSize).map((node) => ({
      id: node.id,
      name: node.name,
      path: node.path,
      depth: node.depth,
      imageCount: imageCountById.get(node.id) ?? 0,
    })),
    pagination: { page: currentPage, pageSize, total, totalPages },
  };
}

function minimalMatchedPaths(nodes: { id: string; path: string }[]) {
  const sorted = [...nodes].sort((left, right) => left.path.length - right.path.length);
  const kept: { id: string; path: string }[] = [];

  for (const node of sorted) {
    if (!kept.some((parent) => node.path.startsWith(`${parent.path} /`))) {
      kept.push(node);
    }
  }

  return kept;
}

export async function navigatorImageWhere(
  optionIds: string[],
): Promise<Prisma.ChartImageWhereInput | null> {
  const uniqueIds = [...new Set(optionIds.filter(Boolean))];
  if (uniqueIds.length === 0) {
    return null;
  }

  const matchedNodes = await findMatchedNavigatorNodes(uniqueIds);
  if (matchedNodes.length === 0) {
    return { id: { in: [] } };
  }

  const roots = minimalMatchedPaths(matchedNodes);
  return {
    OR: roots.flatMap((node) => [
      { indexNodeId: node.id },
      { indexNode: { path: { startsWith: `${node.path} /` } } },
    ]),
  };
}
