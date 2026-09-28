import { prepareAiReferenceImage } from "@/lib/ai-ocr-refinement";
import {
  type ReadingImageSnapshot,
  readingImageLimit,
} from "@/lib/ai-reading-companion";
import { prisma } from "@/lib/db";
import { readStoredImage } from "@/lib/storage";

export async function loadReadingImageContext(imageId: string) {
  const image = await prisma.chartImage.findUnique({
    where: { id: imageId },
    include: {
      tags: { include: { tag: true } },
      annotations: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] },
      indexNode: {
        include: {
          navigatorOptions: {
            include: { option: { include: { category: true } } },
          },
        },
      },
    },
  });
  if (!image) return null;

  const attributes = new Map<string, string[]>();
  const assignments = [...(image.indexNode?.navigatorOptions ?? [])].sort((left, right) => {
    if (left.option.category.sortOrder !== right.option.category.sortOrder) {
      return left.option.category.sortOrder - right.option.category.sortOrder;
    }
    if (left.option.sortOrder !== right.option.sortOrder) {
      return left.option.sortOrder - right.option.sortOrder;
    }
    return left.option.name.localeCompare(right.option.name);
  });
  for (const assignment of assignments) {
    const category = assignment.option.category.name;
    attributes.set(category, [...(attributes.get(category) ?? []), assignment.option.name]);
  }

  const snapshot: ReadingImageSnapshot = {
    title: image.title,
    originalName: image.originalName,
    tags: image.tags.map((item) => item.tag.name).sort((a, b) => a.localeCompare(b)),
    notes: image.notes,
    ocr: {
      status: image.ocrStatus,
      text: image.ocrText,
      updatedAt: image.ocrUpdatedAt?.toISOString() ?? null,
    },
    annotations: image.annotations.map((annotation) => ({
      text: annotation.text,
      x: annotation.x,
      y: annotation.y,
      width: annotation.width,
      height: annotation.height,
      fontSize: annotation.fontSize,
      color: annotation.color,
      backgroundColor: annotation.backgroundColor,
      sortOrder: annotation.sortOrder,
    })),
    index: image.indexNode
      ? {
          name: image.indexNode.name,
          path: image.indexNode.path,
          navigatorAttributes: [...attributes.entries()].map(([category, values]) => ({
            category,
            values,
          })),
        }
      : null,
    technical: {
      mimeType: image.mimeType,
      sizeBytes: image.sizeBytes,
      width: image.width,
      height: image.height,
      hash: image.hash,
      createdAt: image.createdAt.toISOString(),
      updatedAt: image.updatedAt.toISOString(),
    },
  };

  return {
    id: image.id,
    libraryPath: image.libraryPath,
    snapshot,
    snapshotJson: JSON.stringify(snapshot),
  };
}

async function imageDataUrl(libraryPath: string) {
  const { buffer } = await readStoredImage(libraryPath);
  const prepared = await prepareAiReferenceImage(buffer);
  return `data:image/jpeg;base64,${prepared.toString("base64")}`;
}

export async function prepareReadingImageDataUrls(
  imageIds: Set<string>,
  requiredImage: { id: string; libraryPath: string },
) {
  const selectedIds = [...imageIds].slice(0, readingImageLimit);
  if (!selectedIds.includes(requiredImage.id)) {
    selectedIds.pop();
    selectedIds.unshift(requiredImage.id);
  }
  const rows = await prisma.chartImage.findMany({
    where: { id: { in: selectedIds } },
    select: { id: true, libraryPath: true },
  });
  const byId = new Map(rows.map((row) => [row.id, row]));
  byId.set(requiredImage.id, requiredImage);
  const urls = new Map<string, string>();

  for (const id of selectedIds) {
    const row = byId.get(id);
    if (!row) continue;
    try {
      urls.set(id, await imageDataUrl(row.libraryPath));
    } catch (error) {
      if (id === requiredImage.id) throw error;
    }
  }
  return urls;
}
