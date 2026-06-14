import { ensureIndexPath } from "@/lib/index-tree";
import { prisma } from "@/lib/db";
import {
  getImageDimensions,
  hashBuffer,
  saveImageBuffer,
} from "@/lib/storage";

export type ImportImageBufferInput = {
  batchId: string;
  buffer: Buffer;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  relativePath?: string | null;
  groupKey: string;
  indexPath?: string[];
  indexNodeId?: string | null;
  dimensions?: {
    width: number | null;
    height: number | null;
  };
  title?: string | null;
  ocrEnabled?: boolean;
};

export type ImportImageBufferResult = {
  status: "IMPORTED" | "DUPLICATE";
  imageId?: string;
  libraryPath: string;
};

export async function importImageBuffer({
  batchId,
  buffer,
  fileName,
  mimeType,
  sizeBytes,
  relativePath,
  groupKey,
  indexPath,
  indexNodeId,
  dimensions: knownDimensions,
  title,
  ocrEnabled = false,
}: ImportImageBufferInput): Promise<ImportImageBufferResult> {
  const indexNode = indexNodeId
    ? { id: indexNodeId }
    : indexPath?.length
      ? await ensureIndexPath(indexPath)
      : null;
  const hash = hashBuffer(buffer);
  const existing = await prisma.chartImage.findUnique({ where: { hash } });

  if (existing) {
    await prisma.importItem.create({
      data: {
        batchId,
        indexNodeId: indexNode?.id ?? existing.indexNodeId,
        originalName: fileName,
        relativePath,
        savedPath: existing.libraryPath,
        groupKey,
        status: "DUPLICATE",
        error: "Duplicate image skipped by SHA-256 hash.",
      },
    });

    return {
      status: "DUPLICATE",
      imageId: existing.id,
      libraryPath: existing.libraryPath,
    };
  }

  const [dimensions, libraryPath] = await Promise.all([
    knownDimensions ? Promise.resolve(knownDimensions) : getImageDimensions(buffer),
    saveImageBuffer({ name: fileName, type: mimeType }, buffer, hash),
  ]);

  const image = await prisma.chartImage.create({
    data: {
      libraryPath,
      originalName: fileName,
      mimeType,
      sizeBytes,
      width: dimensions.width,
      height: dimensions.height,
      hash,
      title: title ?? fileName.replace(/\.[^.]+$/, ""),
      indexNodeId: indexNode?.id ?? null,
      importBatchId: batchId,
      ocrStatus: ocrEnabled ? "PENDING" : "SKIPPED",
    },
  });

  await prisma.importItem.create({
    data: {
      batchId,
      chartImageId: image.id,
      indexNodeId: indexNode?.id ?? null,
      originalName: fileName,
      relativePath,
      savedPath: libraryPath,
      groupKey,
      status: "IMPORTED",
    },
  });

  return {
    status: "IMPORTED",
    imageId: image.id,
    libraryPath,
  };
}
