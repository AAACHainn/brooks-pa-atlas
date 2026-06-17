import { NextResponse } from "next/server";

import {
  imageAnnotationsPayloadSchema,
  serializeImageAnnotation,
} from "@/lib/image-annotations";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PUT(
  request: Request,
  context: RouteContext<"/api/images/[id]/annotations">,
) {
  const { id } = await context.params;
  const body = (await request.json()) as { annotations?: unknown };
  const parsed = imageAnnotationsPayloadSchema.safeParse(body.annotations);

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid image annotations." }, { status: 400 });
  }

  const image = await prisma.chartImage.findUnique({
    where: { id },
    select: { id: true },
  });
  if (!image) {
    return NextResponse.json({ error: "Image not found." }, { status: 404 });
  }

  const annotations = await prisma.$transaction(async (tx) => {
    const existing = await tx.imageAnnotation.findMany({
      where: { chartImageId: id },
      select: { id: true },
    });
    const existingIds = new Set(existing.map((annotation) => annotation.id));
    const keptIds = parsed.data
      .map((annotation) => annotation.id)
      .filter((annotationId): annotationId is string => Boolean(annotationId && existingIds.has(annotationId)));

    await tx.imageAnnotation.deleteMany({
      where: {
        chartImageId: id,
        ...(keptIds.length > 0 ? { id: { notIn: keptIds } } : {}),
      },
    });

    for (const [index, annotation] of parsed.data.entries()) {
      const data = {
        text: annotation.text,
        x: annotation.x,
        y: annotation.y,
        width: annotation.width,
        height: annotation.height,
        fontSize: annotation.fontSize,
        color: annotation.color,
        backgroundColor: null,
        sortOrder: index,
      };

      if (annotation.id && existingIds.has(annotation.id)) {
        await tx.imageAnnotation.update({
          where: { id: annotation.id },
          data,
        });
      } else {
        await tx.imageAnnotation.create({
          data: {
            ...data,
            chartImageId: id,
          },
        });
      }
    }

    return tx.imageAnnotation.findMany({
      where: { chartImageId: id },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    });
  });

  return NextResponse.json({
    annotations: annotations.map(serializeImageAnnotation),
  });
}
