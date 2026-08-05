import type { Prisma } from "@/generated/prisma/client";

import { prisma } from "@/lib/db";

export function normalizeNavigatorName(value: string) {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

export function cleanNavigatorName(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

export async function getNavigatorBootstrap() {
  const [categories, assignments] = await Promise.all([
    prisma.indexNavigatorCategory.findMany({
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      include: {
        options: {
          orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
          include: { _count: { select: { nodeAssignments: true } } },
        },
      },
    }),
    prisma.indexNodeNavigatorOption.findMany({
      select: { indexNodeId: true, optionId: true },
      orderBy: [{ optionId: "asc" }, { indexNodeId: "asc" }],
    }),
  ]);

  return {
    categories: categories.map((category) => ({
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
    })),
    assignments,
  };
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
  // Keep all descendant paths inside one relation filter. Expanding one relation
  // branch per node makes Prisma generate enough SQLite joins to hit its 64-table limit.
  return {
    OR: [
      { indexNodeId: { in: roots.map((node) => node.id) } },
      {
        indexNode: {
          OR: roots.map((node) => ({
            path: { startsWith: `${node.path} /` },
          })),
        },
      },
    ],
  };
}
