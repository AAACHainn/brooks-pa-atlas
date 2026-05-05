import { NextResponse } from "next/server";

import { ensureIndexPath } from "@/lib/index-tree";
import { prisma } from "@/lib/db";
import {
  fileToBuffer,
  getImageDimensions,
  hashBuffer,
  isSupportedImage,
  saveImageBuffer,
} from "@/lib/storage";
import { scheduleOcrPump, updateBatchCounters } from "@/lib/ocr-queue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type GroupAssignments = Record<string, string[]>;

function parseJsonField<T>(formData: FormData, key: string, fallback: T): T {
  const raw = formData.get(key);
  if (typeof raw !== "string" || !raw.trim()) {
    return fallback;
  }

  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function valueAt(values: FormDataEntryValue[], index: number) {
  const value = values[index];
  return typeof value === "string" ? value : "";
}

async function getOrCreateBatch(batchId: string | null, totalCount: number) {
  if (batchId) {
    const existing = await prisma.importBatch.findUnique({ where: { id: batchId } });
    if (existing) {
      return existing;
    }
  }

  return prisma.importBatch.create({
    data: {
      status: "IMPORTING",
      totalCount,
      startedAt: new Date(),
    },
  });
}

export async function POST(request: Request) {
  const formData = await request.formData();
  const files = formData.getAll("files").filter((item): item is File => item instanceof File);
  const relativePaths = formData.getAll("relativePaths");
  const groupKeys = formData.getAll("groupKeys");
  const assignments = parseJsonField<GroupAssignments>(formData, "assignments", {});
  const totalCount = Number(formData.get("totalCount")) || files.length;
  const batchId = typeof formData.get("batchId") === "string" ? String(formData.get("batchId")) : null;
  const batch = await getOrCreateBatch(batchId, totalCount);

  let imported = 0;
  let failed = 0;
  let duplicate = 0;

  for (const [index, file] of files.entries()) {
    const relativePath = valueAt(relativePaths, index);
    const groupKey = valueAt(groupKeys, index) || "Ungrouped";
    const assignment = assignments[groupKey] ?? [];

    try {
      if (!isSupportedImage(file)) {
        throw new Error(`Unsupported file type: ${file.type || "unknown"}`);
      }

      const indexNode = assignment.length ? await ensureIndexPath(assignment) : null;
      const buffer = await fileToBuffer(file);
      const hash = hashBuffer(buffer);
      const existing = await prisma.chartImage.findUnique({ where: { hash } });

      if (existing) {
        await prisma.importItem.create({
          data: {
            batchId: batch.id,
            chartImageId: existing.id,
            indexNodeId: indexNode?.id ?? existing.indexNodeId,
            originalName: file.name,
            relativePath,
            savedPath: existing.libraryPath,
            groupKey,
            status: "DUPLICATE",
            error: "Duplicate image skipped by SHA-256 hash.",
          },
        });
        duplicate += 1;
        continue;
      }

      const [dimensions, libraryPath] = await Promise.all([
        getImageDimensions(buffer),
        saveImageBuffer(file, buffer, hash),
      ]);

      const image = await prisma.chartImage.create({
        data: {
          libraryPath,
          originalName: file.name,
          mimeType: file.type || "application/octet-stream",
          sizeBytes: file.size,
          width: dimensions.width,
          height: dimensions.height,
          hash,
          title: file.name.replace(/\.[^.]+$/, ""),
          indexNodeId: indexNode?.id ?? null,
          importBatchId: batch.id,
          ocrStatus: "PENDING",
        },
      });

      await prisma.importItem.create({
        data: {
          batchId: batch.id,
          chartImageId: image.id,
          indexNodeId: indexNode?.id ?? null,
          originalName: file.name,
          relativePath,
          savedPath: libraryPath,
          groupKey,
          status: "IMPORTED",
        },
      });

      imported += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Import failed.";
      await prisma.importItem.create({
        data: {
          batchId: batch.id,
          originalName: file.name,
          relativePath,
          groupKey,
          status: "FAILED",
          error: message.slice(0, 1000),
        },
      });
      failed += 1;
    }
  }

  const processedCount = await prisma.importItem.count({ where: { batchId: batch.id } });
  await prisma.importBatch.update({
    where: { id: batch.id },
    data: {
      totalCount,
      status: processedCount >= totalCount ? "PROCESSING_OCR" : "IMPORTING",
      error: failed > 0 ? `${failed} item(s) failed in the latest chunk.` : null,
    },
  });

  await updateBatchCounters(batch.id);
  scheduleOcrPump();

  return NextResponse.json({
    batchId: batch.id,
    received: files.length,
    imported,
    failed,
    duplicate,
    processedCount,
  });
}
