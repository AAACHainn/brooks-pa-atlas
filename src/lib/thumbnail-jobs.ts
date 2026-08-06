import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import { prisma } from "@/lib/db";
import {
  ensureStoredImageThumbnail,
  thumbnailExists,
  thumbnailVersion,
} from "@/lib/thumbnails";

export type ThumbnailJobStatus =
  | "running"
  | "interrupted"
  | "completed"
  | "completed_with_errors"
  | "failed";

export type ThumbnailJobError = {
  imageId: string;
  hash: string;
  error: string;
  at: string;
};

export type ThumbnailJob = {
  id: string;
  kind: "thumbnail-backfill";
  status: ThumbnailJobStatus;
  phase: string;
  totalImages: number;
  processedImages: number;
  generatedImages: number;
  skippedImages: number;
  failedImages: number;
  progressPercent: number;
  recentErrors: ThumbnailJobError[];
  createdAt: string;
  updatedAt: string;
  finishedAt: string | null;
  resumedFrom: string | null;
};

type ThumbnailJobStore = {
  activeJobId: string | null;
  jobs: Map<string, ThumbnailJob>;
  startPromise?: Promise<{ job: ThumbnailJob; reused: boolean }> | null;
};

type ThumbnailJobImage = {
  id: string;
  hash: string;
  libraryPath: string;
};

const jobBatchSize = 200;
const persistEveryImages = 25;
const persistEveryMs = 1_000;
const recentErrorLimit = 20;

const globalForThumbnailJobs = globalThis as typeof globalThis & {
  brooksThumbnailJobStore?: ThumbnailJobStore;
};

const store = globalForThumbnailJobs.brooksThumbnailJobStore ?? {
  activeJobId: null,
  jobs: new Map<string, ThumbnailJob>(),
  startPromise: null,
};
globalForThumbnailJobs.brooksThumbnailJobStore = store;

function nowIso() {
  return new Date().toISOString();
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function jobFileName(id: string) {
  if (!/^[a-f0-9-]{36}$/i.test(id)) throw new Error("Invalid thumbnail job id.");
  return `${id}.json`;
}

export function getThumbnailJobRoot() {
  return path.join(
    /*turbopackIgnore: true*/ process.cwd(),
    "data",
    "library",
    "thumbnail-jobs",
  );
}

async function writeAtomicJson(targetPath: string, value: unknown) {
  await mkdir(path.dirname(targetPath), { recursive: true });
  const temporaryPath = `${targetPath}.tmp-${process.pid}-${randomUUID()}`;
  try {
    await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
    });
    await rename(temporaryPath, targetPath);
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
}

async function persistJob(job: ThumbnailJob) {
  job.updatedAt = nowIso();
  const root = getThumbnailJobRoot();
  await writeAtomicJson(path.join(root, jobFileName(job.id)), job);
  await writeAtomicJson(path.join(root, "latest.json"), { id: job.id });
}

async function readJson<T>(filePath: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as T;
  } catch (error) {
    const code = error instanceof Error && "code" in error ? error.code : null;
    if (code === "ENOENT") return null;
    throw error;
  }
}

async function markInterruptedIfNeeded(job: ThumbnailJob) {
  if (job.status !== "running" || store.activeJobId === job.id) return job;
  job.status = "interrupted";
  job.phase = "interrupted";
  job.finishedAt = nowIso();
  job.progressPercent = job.totalImages > 0
    ? Math.min(99, Math.round((job.processedImages / job.totalImages) * 100))
    : 0;
  store.jobs.set(job.id, job);
  await persistJob(job);
  return job;
}

export function serializeThumbnailJob(job: ThumbnailJob) {
  return { ...job, recentErrors: job.recentErrors.map((item) => ({ ...item })) };
}

export async function getThumbnailJob(id: string) {
  const inMemory = store.jobs.get(id);
  if (inMemory) return markInterruptedIfNeeded(inMemory);
  const job = await readJson<ThumbnailJob>(path.join(getThumbnailJobRoot(), jobFileName(id)));
  if (!job) return null;
  store.jobs.set(job.id, job);
  return markInterruptedIfNeeded(job);
}

export async function getLatestThumbnailJob() {
  if (store.activeJobId) {
    const active = store.jobs.get(store.activeJobId);
    if (active) return active;
  }
  const latest = await readJson<{ id?: string }>(path.join(getThumbnailJobRoot(), "latest.json"));
  if (!latest?.id) return null;
  return getThumbnailJob(latest.id);
}

function jobConcurrency() {
  const configured = Number(process.env.BROOKS_THUMBNAIL_CONCURRENCY ?? 1);
  if (!Number.isFinite(configured)) return 1;
  return Math.min(2, Math.max(1, Math.floor(configured)));
}

function updateProgress(job: ThumbnailJob) {
  job.processedImages = job.generatedImages + job.skippedImages + job.failedImages;
  job.progressPercent = job.totalImages > 0
    ? Math.min(99, Math.round((job.processedImages / job.totalImages) * 100))
    : 0;
}

async function runThumbnailJob(job: ThumbnailJob) {
  let lastPersistedCount = 0;
  let lastPersistedAt = Date.now();

  try {
    job.phase = "counting";
    job.totalImages = await prisma.chartImage.count();
    await persistJob(job);
    lastPersistedAt = Date.now();

    job.phase = "generating";
    let cursorId: string | null = null;
    const concurrency = jobConcurrency();

    while (true) {
      const images: ThumbnailJobImage[] = await prisma.chartImage.findMany({
        select: { id: true, hash: true, libraryPath: true },
        orderBy: { id: "asc" },
        take: jobBatchSize,
        ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
      });
      if (images.length === 0) break;

      for (let index = 0; index < images.length; index += concurrency) {
        const group = images.slice(index, index + concurrency);
        const outcomes = await Promise.all(
          group.map(async (image) => {
            try {
              if (await thumbnailExists(image.hash, thumbnailVersion)) return "skipped" as const;
              const result = await ensureStoredImageThumbnail(image);
              return result.generated ? "generated" as const : "skipped" as const;
            } catch (error) {
              return { image, error: errorMessage(error) };
            }
          }),
        );

        for (const outcome of outcomes) {
          if (outcome === "generated") job.generatedImages += 1;
          else if (outcome === "skipped") job.skippedImages += 1;
          else {
            job.failedImages += 1;
            job.recentErrors.push({
              imageId: outcome.image.id,
              hash: outcome.image.hash,
              error: outcome.error,
              at: nowIso(),
            });
            if (job.recentErrors.length > recentErrorLimit) job.recentErrors.shift();
          }
        }

        updateProgress(job);
        const shouldPersist =
          job.processedImages - lastPersistedCount >= persistEveryImages ||
          Date.now() - lastPersistedAt >= persistEveryMs;
        if (shouldPersist) {
          await persistJob(job);
          lastPersistedCount = job.processedImages;
          lastPersistedAt = Date.now();
        }
      }

      cursorId = images[images.length - 1]?.id ?? cursorId;
      if (images.length < jobBatchSize) break;
    }

    job.status = job.failedImages > 0 ? "completed_with_errors" : "completed";
    job.phase = "completed";
    job.progressPercent = 100;
    job.finishedAt = nowIso();
    await persistJob(job);
  } catch (error) {
    job.status = "failed";
    job.phase = "failed";
    job.finishedAt = nowIso();
    job.recentErrors.push({
      imageId: "",
      hash: "",
      error: errorMessage(error),
      at: nowIso(),
    });
    if (job.recentErrors.length > recentErrorLimit) job.recentErrors.shift();
    await persistJob(job).catch((persistError) => {
      console.error("[thumbnail-backfill] failed to persist fatal job state", persistError);
    });
    console.error(`[thumbnail-backfill:${job.id}] job failed`, error);
  } finally {
    if (store.activeJobId === job.id) store.activeJobId = null;
  }
}

async function startThumbnailJobLocked() {
  const active = store.activeJobId ? store.jobs.get(store.activeJobId) : null;
  if (active?.status === "running") return { job: active, reused: true };

  const latest = await getLatestThumbnailJob();
  if (latest?.status === "running") return { job: latest, reused: true };

  const timestamp = nowIso();
  const job: ThumbnailJob = {
    id: randomUUID(),
    kind: "thumbnail-backfill",
    status: "running",
    phase: "queued",
    totalImages: 0,
    processedImages: 0,
    generatedImages: 0,
    skippedImages: 0,
    failedImages: 0,
    progressPercent: 0,
    recentErrors: [],
    createdAt: timestamp,
    updatedAt: timestamp,
    finishedAt: null,
    resumedFrom: latest?.status === "interrupted" ? latest.id : null,
  };
  store.jobs.set(job.id, job);
  store.activeJobId = job.id;
  await persistJob(job);
  void runThumbnailJob(job);
  return { job, reused: false };
}

export async function startThumbnailJob() {
  if (store.startPromise) {
    const result = await store.startPromise;
    return { job: result.job, reused: true };
  }

  const promise = startThumbnailJobLocked();
  store.startPromise = promise;
  try {
    return await promise;
  } finally {
    if (store.startPromise === promise) store.startPromise = null;
  }
}
