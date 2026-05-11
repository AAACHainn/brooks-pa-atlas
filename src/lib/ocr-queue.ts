import { execFile } from "node:child_process";
import os from "node:os";
import { promisify } from "node:util";

import { prisma } from "@/lib/db";
import { absoluteImagePath } from "@/lib/storage";

const execFileAsync = promisify(execFile);
const DEFAULT_OCR_LANGUAGE = "chi_sim+eng";

const running = new Set<string>();
let activeWorkers = 0;
let pumpScheduled = false;

async function getConcurrency() {
  const setting = await prisma.appSetting.findUnique({
    where: { key: "ocr.concurrency" },
  });

  const parsed = Number(setting?.value);
  if (Number.isFinite(parsed) && parsed >= 1) {
    return Math.min(Math.floor(parsed), 8);
  }

  return Math.max(2, Math.min(4, Math.floor(os.cpus().length / 2) || 2));
}

async function updateBatchCounters(batchId: string) {
  const [batch, processedCount, successCount, failedCount, duplicateCount, ocrPendingCount, ocrCompletedCount, ocrFailedCount] =
    await Promise.all([
      prisma.importBatch.findUnique({ where: { id: batchId } }),
      prisma.importItem.count({ where: { batchId } }),
      prisma.importItem.count({ where: { batchId, status: "IMPORTED" } }),
      prisma.importItem.count({ where: { batchId, status: "FAILED" } }),
      prisma.importItem.count({ where: { batchId, status: "DUPLICATE" } }),
      prisma.chartImage.count({
        where: { importBatchId: batchId, ocrStatus: { in: ["PENDING", "RUNNING"] } },
      }),
      prisma.chartImage.count({
        where: { importBatchId: batchId, ocrStatus: "COMPLETED" },
      }),
      prisma.chartImage.count({
        where: { importBatchId: batchId, ocrStatus: "FAILED" },
      }),
    ]);

  if (!batch) {
    return;
  }

  const stillImporting = processedCount < batch.totalCount;
  const hasWorkLeft = ocrPendingCount > 0;
  const hasErrors = failedCount > 0 || ocrFailedCount > 0;

  await prisma.importBatch.update({
    where: { id: batchId },
    data: {
      successCount,
      failedCount,
      duplicateCount,
      ocrPendingCount,
      ocrCompletedCount,
      ocrFailedCount,
      status: stillImporting
        ? "IMPORTING"
        : hasWorkLeft
          ? "PROCESSING_OCR"
          : hasErrors
            ? "COMPLETED_WITH_ERRORS"
            : "COMPLETED",
      finishedAt: stillImporting || hasWorkLeft ? null : new Date(),
    },
  });
}

async function runLocalOcr(libraryPath: string) {
  const command = process.env.BROOKS_OCR_COMMAND ?? "tesseract";
  const language = process.env.BROOKS_OCR_LANG ?? DEFAULT_OCR_LANGUAGE;
  const tessdataDir = process.env.BROOKS_TESSDATA_DIR;
  const imagePath = absoluteImagePath(libraryPath);
  const args = [
    ...(tessdataDir ? ["--tessdata-dir", tessdataDir] : []),
    imagePath,
    "stdout",
    "-l",
    language,
  ];
  const { stdout } = await execFileAsync(command, args, {
    timeout: 120_000,
    maxBuffer: 1024 * 1024 * 8,
    windowsHide: true,
  });

  return stdout.trim();
}

async function processImage(imageId: string) {
  running.add(imageId);
  activeWorkers += 1;

  try {
    const image = await prisma.chartImage.update({
      where: { id: imageId },
      data: {
        ocrStatus: "RUNNING",
        ocrError: null,
        ocrUpdatedAt: new Date(),
      },
    });

    const text = await runLocalOcr(image.libraryPath);

    await prisma.chartImage.update({
      where: { id: image.id },
      data: {
        ocrText: text,
        ocrStatus: "COMPLETED",
        ocrError: null,
        ocrUpdatedAt: new Date(),
      },
    });

    if (image.importBatchId) {
      await updateBatchCounters(image.importBatchId);
    }
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "OCR failed with an unknown error.";

    const image = await prisma.chartImage.update({
      where: { id: imageId },
      data: {
        ocrStatus: "FAILED",
        ocrError: message.slice(0, 1000),
        ocrUpdatedAt: new Date(),
      },
    });

    if (image.importBatchId) {
      await updateBatchCounters(image.importBatchId);
    }
  } finally {
    running.delete(imageId);
    activeWorkers -= 1;
    scheduleOcrPump();
  }
}

async function pumpOcrQueue() {
  pumpScheduled = false;
  const concurrency = await getConcurrency();
  const slots = concurrency - activeWorkers;

  if (slots <= 0) {
    return;
  }

  const pending = await prisma.chartImage.findMany({
    where: {
      ocrStatus: "PENDING",
      id: { notIn: Array.from(running) },
    },
    orderBy: { createdAt: "asc" },
    take: slots,
    select: { id: true },
  });

  for (const image of pending) {
    void processImage(image.id);
  }
}

export function scheduleOcrPump() {
  if (pumpScheduled) {
    return;
  }

  pumpScheduled = true;
  setTimeout(() => {
    void pumpOcrQueue();
  }, 50);
}

export async function retryFailedOcr(imageIds?: string[]) {
  await prisma.chartImage.updateMany({
    where: {
      ocrStatus: "FAILED",
      ...(imageIds?.length ? { id: { in: imageIds } } : {}),
    },
    data: {
      ocrStatus: "PENDING",
      ocrError: null,
      ocrUpdatedAt: new Date(),
    },
  });

  scheduleOcrPump();
}

export { updateBatchCounters };
