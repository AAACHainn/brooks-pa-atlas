import { NextResponse } from "next/server";

import { prisma } from "@/lib/db";
import {
  fileToBuffer,
  isSupportedImage,
} from "@/lib/storage";
import { importImageBuffer } from "@/lib/import-images";
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

function pathPartsAt(values: FormDataEntryValue[], index: number) {
  const value = valueAt(values, index);
  if (!value.trim()) {
    return null;
  }

  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) {
      return null;
    }

    return parsed
      .filter((part): part is string => typeof part === "string")
      .map((part) => part.trim())
      .filter(Boolean);
  } catch {
    return null;
  }
}

function parseBooleanField(formData: FormData, key: string) {
  return formData.get(key) === "true";
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
  const indexPaths = formData.getAll("indexPaths");
  const assignments = parseJsonField<GroupAssignments>(formData, "assignments", {});
  const totalCount = Number(formData.get("totalCount")) || files.length;
  const batchId = typeof formData.get("batchId") === "string" ? String(formData.get("batchId")) : null;
  const ocrEnabled = parseBooleanField(formData, "ocrEnabled");
  const batch = await getOrCreateBatch(batchId, totalCount);

  let imported = 0;
  let failed = 0;
  let duplicate = 0;

  for (const [index, file] of files.entries()) {
    const relativePath = valueAt(relativePaths, index);
    const groupKey = valueAt(groupKeys, index) || "Ungrouped";
    const assignment = pathPartsAt(indexPaths, index) ?? assignments[groupKey] ?? [];

    try {
      if (!isSupportedImage(file)) {
        throw new Error(`Unsupported file type: ${file.type || "unknown"}`);
      }

      const buffer = await fileToBuffer(file);
      const result = await importImageBuffer({
        batchId: batch.id,
        buffer,
        fileName: file.name,
        mimeType: file.type || "application/octet-stream",
        sizeBytes: file.size,
        relativePath,
        groupKey,
        indexPath: assignment,
        ocrEnabled,
      });

      if (result.status === "DUPLICATE") {
        duplicate += 1;
        continue;
      }

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
      status: processedCount >= totalCount && ocrEnabled ? "PROCESSING_OCR" : "IMPORTING",
      error: failed > 0 ? `${failed} item(s) failed in the latest chunk.` : null,
    },
  });

  await updateBatchCounters(batch.id);
  if (ocrEnabled) {
    scheduleOcrPump();
  }

  return NextResponse.json({
    batchId: batch.id,
    received: files.length,
    imported,
    failed,
    duplicate,
    processedCount,
  });
}
