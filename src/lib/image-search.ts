import { Prisma } from "@/generated/prisma/client";

import { prisma } from "@/lib/db";

type ImageSearchQueryClient = Pick<typeof prisma, "$queryRaw">;

export async function findLiteralSearchImageIds(
  query: string,
  client: ImageSearchQueryClient = prisma,
) {
  const rows = await client.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT image.id
    FROM "ChartImage" AS image
    LEFT JOIN "IndexNode" AS indexNode ON indexNode.id = image."indexNodeId"
    WHERE
      instr(lower(image."originalName"), lower(${query})) > 0
      OR instr(lower(COALESCE(image.title, '')), lower(${query})) > 0
      OR instr(lower(COALESCE(image.notes, '')), lower(${query})) > 0
      OR instr(lower(COALESCE(image."ocrText", '')), lower(${query})) > 0
      OR instr(lower(COALESCE(indexNode.path, '')), lower(${query})) > 0
      OR EXISTS (
        SELECT 1
        FROM "ChartImageTag" AS imageTag
        INNER JOIN "Tag" AS tag ON tag.id = imageTag."tagId"
        WHERE imageTag."chartImageId" = image.id
          AND instr(lower(tag.name), lower(${query})) > 0
      )
      OR EXISTS (
        SELECT 1
        FROM "ImageAnnotation" AS annotation
        WHERE annotation."chartImageId" = image.id
          AND instr(lower(annotation.text), lower(${query})) > 0
      )
  `);

  return new Set(rows.map((row) => row.id));
}
