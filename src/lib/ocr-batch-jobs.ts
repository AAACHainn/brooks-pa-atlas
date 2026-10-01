import { randomUUID } from "node:crypto";

import type {
  OcrBatchJob,
  OcrBatchJobItemStatus,
  Prisma,
} from "@/generated/prisma/client";

import { prisma } from "@/lib/db";
import { acquireHeavyTaskOrThrow, releaseHeavyTask } from "@/lib/background-task-coordinator";
import {
  hasExistingOcrText,
  ocrBatchConfirmationPhrase,
  ocrBatchProgressPercent,
  ocrBatchTerminalStatus,
} from "@/lib/ocr-batch-job-state";

const activeJobKey = "global";
const prismaChunkSize = 400;

export type OcrBatchJobSnapshot = {
  id: string;
  status: "running" | "completed" | "completed_with_errors" | "failed";
  indexNodeId: string;
  indexPath: string;
  totalImages: number;
  processedImages: number;
  completedImages: number;
  failedImages: number;
  progressPercent: number;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
};

export type IndexOcrBatchSummary = {
  indexNodeId: string;
  indexPath: string;
  totalImages: number;
  existingTextImages: number;
  withoutTextImages: number;
  requiresTypedConfirmation: boolean;
};

export class OcrBatchJobRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
  }
}

function chunkArray<T>(items: T[], size = prismaChunkSize) {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function publicStatus(status: OcrBatchJob["status"]): OcrBatchJobSnapshot["status"] {
  return status.toLowerCase() as OcrBatchJobSnapshot["status"];
}

export function serializeOcrBatchJob(job: OcrBatchJob): OcrBatchJobSnapshot {
  return {
    id: job.id,
    status: publicStatus(job.status),
    indexNodeId: job.indexNodeId,
    indexPath: job.indexPath,
    totalImages: job.totalImages,
    processedImages: job.processedImages,
    completedImages: job.completedImages,
    failedImages: job.failedImages,
    progressPercent: ocrBatchProgressPercent(job.processedImages, job.totalImages),
    error: job.error,
    startedAt: job.startedAt.toISOString(),
    finishedAt: job.finishedAt?.toISOString() ?? null,
  };
}

async function findIndexAndImages(indexNodeId: string, client: Prisma.TransactionClient | typeof prisma) {
  const node = await client.indexNode.findUnique({
    where: { id: indexNodeId },
    select: { id: true, path: true },
  });
  if (!node) {
    throw new OcrBatchJobRequestError("Index node not found.", 404, "INDEX_NOT_FOUND");
  }

  const images = await client.chartImage.findMany({
    where: {
      OR: [
        { indexNodeId: node.id },
        { indexNode: { path: { startsWith: `${node.path} /` } } },
      ],
    },
    orderBy: { id: "asc" },
    select: { id: true, ocrText: true },
  });

  return { node, images };
}

export async function getIndexOcrBatchSummary(indexNodeId: string): Promise<IndexOcrBatchSummary> {
  const { node, images } = await findIndexAndImages(indexNodeId, prisma);
  const existingTextImages = images.filter((image) => hasExistingOcrText(image.ocrText)).length;
  return {
    indexNodeId: node.id,
    indexPath: node.path,
    totalImages: images.length,
    existingTextImages,
    withoutTextImages: images.length - existingTextImages,
    requiresTypedConfirmation: existingTextImages > 0,
  };
}

async function updateJobCounters(client: Prisma.TransactionClient, jobId: string) {
  const [job, completedImages, failedImages] = await Promise.all([
    client.ocrBatchJob.findUnique({ where: { id: jobId } }),
    client.ocrBatchJobItem.count({ where: { jobId, status: "COMPLETED" } }),
    client.ocrBatchJobItem.count({ where: { jobId, status: "FAILED" } }),
  ]);
  if (!job) return null;

  const processedImages = completedImages + failedImages;
  const finished = processedImages >= job.totalImages;
  const status = finished
    ? ocrBatchTerminalStatus(completedImages, failedImages)
    : "RUNNING";

  return client.ocrBatchJob.update({
    where: { id: jobId },
    data: {
      processedImages,
      completedImages,
      failedImages,
      status,
      activeKey: finished ? null : job.activeKey,
      finishedAt: finished ? job.finishedAt ?? new Date() : null,
      error: status === "FAILED" ? "OCR failed for every image in this task." : null,
    },
  });
}

async function incrementJobCounters(
  client: Prisma.TransactionClient,
  jobId: string,
  itemStatus: Extract<OcrBatchJobItemStatus, "COMPLETED" | "FAILED">,
) {
  const job = await client.ocrBatchJob.findUnique({ where: { id: jobId } });
  if (!job || job.status !== "RUNNING") return job;

  const completedImages = job.completedImages + (itemStatus === "COMPLETED" ? 1 : 0);
  const failedImages = job.failedImages + (itemStatus === "FAILED" ? 1 : 0);
  const processedImages = job.processedImages + 1;
  const finished = processedImages >= job.totalImages;
  const status = finished
    ? ocrBatchTerminalStatus(completedImages, failedImages)
    : "RUNNING";

  return client.ocrBatchJob.update({
    where: { id: jobId },
    data: {
      processedImages,
      completedImages,
      failedImages,
      status,
      activeKey: finished ? null : job.activeKey,
      finishedAt: finished ? new Date() : null,
      error: status === "FAILED" ? "OCR failed for every image in this task." : null,
    },
  });
}

export async function startIndexOcrBatchJob(indexNodeId: string, confirmation?: string) {
  const existingJob = await prisma.ocrBatchJob.findUnique({ where: { activeKey: activeJobKey } });
  if (existingJob) {
    throw new OcrBatchJobRequestError(
      "Another batch OCR task is already running.",
      409,
      "ACTIVE_JOB_EXISTS",
    );
  }
  const jobId = randomUUID();
  acquireHeavyTaskOrThrow("ocr-batch", jobId);
  try {
    return await prisma.$transaction(async (tx) => {
    const activeJob = await tx.ocrBatchJob.findUnique({ where: { activeKey: activeJobKey } });
    if (activeJob) {
      throw new OcrBatchJobRequestError(
        "Another batch OCR task is already running.",
        409,
        "ACTIVE_JOB_EXISTS",
      );
    }

    const { node, images } = await findIndexAndImages(indexNodeId, tx);
    if (images.length === 0) {
      throw new OcrBatchJobRequestError(
        "This index subtree has no images.",
        400,
        "NO_IMAGES",
      );
    }

    const existingTextImages = images.filter((image) => hasExistingOcrText(image.ocrText)).length;
    if (existingTextImages > 0 && confirmation !== ocrBatchConfirmationPhrase) {
      throw new OcrBatchJobRequestError(
        "Typed confirmation is required before overwriting OCR text.",
        400,
        "CONFIRMATION_REQUIRED",
      );
    }

    const job = await tx.ocrBatchJob.create({
      data: {
        id: jobId,
        activeKey: activeJobKey,
        indexNodeId: node.id,
        indexPath: node.path,
        totalImages: images.length,
      },
    });

    for (const imageChunk of chunkArray(images)) {
      await tx.ocrBatchJobItem.createMany({
        data: imageChunk.map((image) => ({
          jobId: job.id,
          chartImageId: image.id,
          sourceImageId: image.id,
        })),
      });
      await tx.chartImage.updateMany({
        where: {
          id: { in: imageChunk.map((image) => image.id) },
          ocrStatus: { not: "RUNNING" },
        },
        data: {
          ocrStatus: "PENDING",
          ocrError: null,
          ocrUpdatedAt: new Date(),
        },
      });
    }

      return job;
    }, { maxWait: 5_000, timeout: 60_000 });
  } catch (error) {
    releaseHeavyTask("ocr-batch", jobId);
    throw error;
  }
}

export async function markOcrBatchItemRunning(imageId: string) {
  const item = await prisma.ocrBatchJobItem.findFirst({
    where: {
      sourceImageId: imageId,
      status: "PENDING",
      job: { activeKey: activeJobKey },
    },
    select: { id: true },
  });
  if (!item) return;
  await prisma.ocrBatchJobItem.updateMany({
    where: { id: item.id, status: "PENDING" },
    data: { status: "RUNNING", error: null },
  });
}

export async function settleOcrBatchItem(
  imageId: string,
  status: Extract<OcrBatchJobItemStatus, "COMPLETED" | "FAILED">,
  error: string | null = null,
) {
  const job = await prisma.$transaction(async (tx) => {
    const item = await tx.ocrBatchJobItem.findFirst({
      where: {
        sourceImageId: imageId,
        status: { in: ["PENDING", "RUNNING"] },
        job: { activeKey: activeJobKey },
      },
      select: { id: true, jobId: true },
    });
    if (!item) return null;

    await tx.ocrBatchJobItem.update({
      where: { id: item.id },
      data: { status, error: error?.slice(0, 1000) ?? null },
    });
    return incrementJobCounters(tx, item.jobId, status);
  });
  if (job && job.status !== "RUNNING") releaseHeavyTask("ocr-batch", job.id);
  return job;
}

async function reconcileMissingItems(jobId: string) {
  return prisma.$transaction(async (tx) => {
    const missing = await tx.ocrBatchJobItem.findMany({
      where: {
        jobId,
        chartImageId: null,
        status: { in: ["PENDING", "RUNNING"] },
      },
      select: { id: true },
    });
    if (missing.length === 0) return null;

    for (const itemChunk of chunkArray(missing)) {
      await tx.ocrBatchJobItem.updateMany({
        where: { id: { in: itemChunk.map((item) => item.id) } },
        data: { status: "FAILED", error: "Image was removed before OCR completed." },
      });
    }
    return updateJobCounters(tx, jobId);
  });
}

export async function getOcrBatchJob(jobId: string) {
  const job = await prisma.ocrBatchJob.findUnique({ where: { id: jobId } });
  if (!job) return null;
  if (job.status !== "RUNNING") return job;
  const refreshed = (await reconcileMissingItems(job.id)) ??
    await prisma.ocrBatchJob.findUnique({ where: { id: job.id } });
  if (refreshed && refreshed.status !== "RUNNING") releaseHeavyTask("ocr-batch", refreshed.id);
  return refreshed;
}

export async function getActiveOcrBatchJob() {
  const job = await prisma.ocrBatchJob.findUnique({ where: { activeKey: activeJobKey } });
  if (!job) return null;
  const refreshed = (await reconcileMissingItems(job.id)) ??
    await prisma.ocrBatchJob.findUnique({ where: { id: job.id } });
  if (refreshed && refreshed.status !== "RUNNING") releaseHeavyTask("ocr-batch", refreshed.id);
  return refreshed;
}

export async function recoverActiveOcrBatchJob() {
  const job = await prisma.ocrBatchJob.findUnique({ where: { activeKey: activeJobKey } });
  if (!job) return null;
  acquireHeavyTaskOrThrow("ocr-batch", job.id);
  try {
    const pendingItems = await prisma.ocrBatchJobItem.findMany({
      where: {
        jobId: job.id,
        status: { in: ["PENDING", "RUNNING"] },
        chartImageId: { not: null },
      },
      select: { id: true, chartImageId: true },
    });

    await prisma.$transaction(async (tx) => {
      for (const itemChunk of chunkArray(pendingItems)) {
        await tx.ocrBatchJobItem.updateMany({
          where: { id: { in: itemChunk.map((item) => item.id) } },
          data: { status: "PENDING", error: null },
        });
        await tx.chartImage.updateMany({
          where: { id: { in: itemChunk.flatMap((item) => item.chartImageId ?? []) } },
          data: { ocrStatus: "PENDING", ocrError: null, ocrUpdatedAt: new Date() },
        });
      }
    }, { maxWait: 5_000, timeout: 60_000 });

    const reconciled = await reconcileMissingItems(job.id);
    const refreshed = reconciled ?? await prisma.ocrBatchJob.findUnique({ where: { id: job.id } });
    if (refreshed && refreshed.status !== "RUNNING") releaseHeavyTask("ocr-batch", job.id);
    return refreshed;
  } catch (error) {
    releaseHeavyTask("ocr-batch", job.id);
    throw error;
  }
}
