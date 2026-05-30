import type { Prisma } from "@/generated/prisma/client";

export type TagSummary = {
  id: string;
  name: string;
};

export function normalizeTagName(value: string) {
  return value.trim().toLowerCase();
}

export function normalizeTagNames(values: string[]) {
  const names = new Map<string, string>();

  for (const value of values) {
    const name = value.trim();
    const normalizedName = normalizeTagName(name);
    if (normalizedName && !names.has(normalizedName)) {
      names.set(normalizedName, name);
    }
  }

  return [...names].map(([normalizedName, name]) => ({ name, normalizedName }));
}

export async function ensureTags(
  tx: Prisma.TransactionClient,
  values: string[],
) {
  const tags: TagSummary[] = [];

  for (const value of normalizeTagNames(values)) {
    tags.push(
      await tx.tag.upsert({
        where: { normalizedName: value.normalizedName },
        create: value,
        update: {},
        select: { id: true, name: true },
      }),
    );
  }

  return tags.sort((left, right) => left.name.localeCompare(right.name));
}

export async function cleanupUnusedTags(tx: Prisma.TransactionClient) {
  await tx.tag.deleteMany({
    where: { images: { none: {} } },
  });
}

export async function connectImageTags(
  tx: Prisma.TransactionClient,
  chartImageIds: string[],
  tags: TagSummary[],
) {
  for (const chartImageId of chartImageIds) {
    for (const tag of tags) {
      await tx.chartImageTag.upsert({
        where: {
          chartImageId_tagId: {
            chartImageId,
            tagId: tag.id,
          },
        },
        create: { chartImageId, tagId: tag.id },
        update: {},
      });
    }
  }
}

export async function replaceImageTags(
  tx: Prisma.TransactionClient,
  chartImageId: string,
  names: string[],
  options: { cleanup?: boolean } = {},
) {
  const tags = await ensureTags(tx, names);
  const tagIds = tags.map((tag) => tag.id);

  await tx.chartImageTag.deleteMany({
    where: {
      chartImageId,
      ...(tagIds.length > 0 ? { tagId: { notIn: tagIds } } : {}),
    },
  });

  if (tagIds.length > 0) {
    await connectImageTags(tx, [chartImageId], tags);
  }

  if (options.cleanup !== false) {
    await cleanupUnusedTags(tx);
  }

  return tags;
}
