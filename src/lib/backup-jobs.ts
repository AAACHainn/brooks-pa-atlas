import { randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import { createBackupZip, restoreBackupZipFromFile } from "@/lib/backup";
import { attachmentContentDisposition } from "@/lib/download-response";

type JobStatus = "running" | "completed" | "failed";

type BackupJobResult = {
  fileName: string;
  sizeBytes: number;
};

export type BackupRecord = {
  id: string;
  fileName: string;
  sizeBytes: number;
  createdAt: string;
  imageCount: number;
  indexId: string | null;
};

type RestoreJobResult = Awaited<ReturnType<typeof restoreBackupZipFromFile>>;

type BackupJob = {
  id: string;
  kind: "backup";
  status: JobStatus;
  phase: string;
  progressPercent: number;
  processedImages: number;
  totalImages: number;
  processedBytes: number;
  totalBytes: number;
  error: string | null;
  result: BackupJobResult | null;
  createdAt: number;
  updatedAt: number;
};

type RestoreJob = {
  id: string;
  kind: "restore";
  status: JobStatus;
  phase: string;
  progressPercent: number;
  processedImages: number;
  totalImages: number;
  error: string | null;
  result: RestoreJobResult | null;
  createdAt: number;
  updatedAt: number;
};

export type BackupTaskJob = BackupJob | RestoreJob;

type JobStore = Map<string, BackupTaskJob>;
type BackupJobOptions = {
  indexId?: string | null;
};

const jobTtlMs = 30 * 60 * 1000;
const backupDirectory = path.join(
  /* turbopackIgnore: true */ process.cwd(),
  "data",
  "library",
  "backups",
);
const backupFilePrefix = "brooks-pa-atlas-backup-record-";
const backupJobIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const globalForBackupJobs = globalThis as typeof globalThis & {
  brooksBackupJobs?: JobStore;
};

const jobs = globalForBackupJobs.brooksBackupJobs ?? new Map<string, BackupTaskJob>();
globalForBackupJobs.brooksBackupJobs = jobs;

function now() {
  return Date.now();
}

function touch(job: BackupTaskJob) {
  job.updatedAt = now();
}

function cleanupJobs() {
  const cutoff = now() - jobTtlMs;
  for (const [id, job] of jobs) {
    if (job.updatedAt < cutoff) {
      jobs.delete(id);
    }
  }
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function backupJobFilePath(id: string) {
  return path.join(backupDirectory, `${backupFilePrefix}${id}.zip`);
}

function backupJobMetadataFilePath(id: string) {
  return path.join(backupDirectory, `${backupFilePrefix}${id}.json`);
}

async function readBackupRecordMetadata(id: string): Promise<BackupRecord | null> {
  if (!backupJobIdPattern.test(id)) return null;
  const raw = await readFile(backupJobMetadataFilePath(id), "utf8").catch(() => null);
  if (!raw) return null;

  try {
    const value = JSON.parse(raw) as Partial<BackupRecord>;
    if (
      value.id !== id ||
      typeof value.fileName !== "string" ||
      !value.fileName.trim() ||
      value.fileName.length > 512 ||
      typeof value.sizeBytes !== "number" ||
      !Number.isSafeInteger(value.sizeBytes) ||
      value.sizeBytes < 0 ||
      typeof value.createdAt !== "string" ||
      Number.isNaN(new Date(value.createdAt).getTime()) ||
      typeof value.imageCount !== "number" ||
      !Number.isSafeInteger(value.imageCount) ||
      value.imageCount < 0 ||
      (value.indexId !== null && typeof value.indexId !== "string")
    ) {
      return null;
    }
    return value as BackupRecord;
  } catch {
    return null;
  }
}

async function readBackupRecord(id: string): Promise<BackupRecord | null> {
  const record = await readBackupRecordMetadata(id);
  if (!record) return null;
  const fileStat = await stat(backupJobFilePath(id)).catch(() => null);
  if (!fileStat?.isFile() || fileStat.size !== record.sizeBytes) return null;
  return record;
}

export async function listBackupRecords() {
  await mkdir(backupDirectory, { recursive: true });
  const entries = await readdir(backupDirectory, { withFileTypes: true });
  const ids = entries
    .filter((entry) => entry.isFile() && entry.name.startsWith(backupFilePrefix) && entry.name.endsWith(".json"))
    .map((entry) => entry.name.slice(backupFilePrefix.length, -".json".length))
    .filter((id) => backupJobIdPattern.test(id));
  const records = (await Promise.all(ids.map((id) => readBackupRecord(id))))
    .filter((record): record is BackupRecord => record !== null)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  return records;
}

async function unlinkIfPresent(filePath: string) {
  try {
    await unlink(filePath);
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
      throw error;
    }
  }
}

export async function deleteBackupRecord(id: string) {
  const record = await readBackupRecordMetadata(id);
  if (!record) return false;
  let deleteError: unknown = null;
  try {
    await unlinkIfPresent(backupJobFilePath(id));
  } catch (error) {
    deleteError = error;
  }
  try {
    await unlinkIfPresent(backupJobMetadataFilePath(id));
  } catch (error) {
    deleteError ??= error;
  }
  jobs.delete(id);
  if (deleteError) throw deleteError;
  return true;
}

function publicJob(job: BackupTaskJob) {
  return {
    id: job.id,
    kind: job.kind,
    status: job.status,
    phase: job.phase,
    progressPercent: job.progressPercent,
    processedImages: job.processedImages,
    totalImages: job.totalImages,
    processedBytes: job.kind === "backup" ? job.processedBytes : null,
    totalBytes: job.kind === "backup" ? job.totalBytes : null,
    error: job.error,
    fileName: job.kind === "backup" ? job.result?.fileName ?? null : null,
    sizeBytes: job.kind === "backup" ? job.result?.sizeBytes ?? null : null,
    stats: job.kind === "restore" ? job.result : null,
  };
}

export function serializeBackupJob(job: BackupTaskJob) {
  return publicJob(job);
}

export function getBackupJob(id: string) {
  cleanupJobs();
  return jobs.get(id) ?? null;
}

function backupFileHeaders(fileName: string, contentLength: number) {
  return {
    "Accept-Ranges": "bytes",
    "Cache-Control": "no-store",
    "Content-Disposition": attachmentContentDisposition(fileName),
    "Content-Length": String(contentLength),
    "Content-Type": "application/zip",
  };
}

export async function backupDownloadResponse(request: Request, id: string, headOnly = false) {
  if (!backupJobIdPattern.test(id)) {
    return Response.json({ error: "Backup job not found." }, { status: 404 });
  }

  const job = getBackupJob(id);
  if (job && (job.kind !== "backup" || job.status !== "completed" || !job.result)) {
    console.warn(`[backup-export:${id}] file request before completion`, {
      status: job.status,
      phase: job.phase,
      processedImages: job.processedImages,
      totalImages: job.totalImages,
    });
    return Response.json({ error: "Backup job is not complete." }, { status: 409 });
  }

  const filePath = backupJobFilePath(id);
  const record = await readBackupRecord(id);
  if (!record) return Response.json({ error: "Backup record not found." }, { status: 404 });
  const fileName = record.fileName;
  const fileStat = await stat(filePath).catch((error) => {
    console.error(`[backup-export:${id}] file response failed`, {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      fileName,
    });
    return null;
  });
  if (!fileStat) {
    return Response.json({ error: "Backup file download failed." }, { status: 500 });
  }
  if (record.sizeBytes !== fileStat.size) {
    return Response.json({ error: "Backup file is incomplete." }, { status: 500 });
  }
  if (job) touch(job);

  if (headOnly) {
    return new Response(null, {
      headers: backupFileHeaders(fileName, fileStat.size),
    });
  }

  const range = request.headers.get("range")?.match(/^bytes=(\d*)-(\d*)$/i);
  let start = 0;
  let end = fileStat.size - 1;
  let status = 200;

  if (range) {
    const requestedStart = range[1] ? Number(range[1]) : null;
    const requestedEnd = range[2] ? Number(range[2]) : null;

    if (requestedStart === null && requestedEnd !== null) {
      start = Math.max(0, fileStat.size - requestedEnd);
    } else {
      start = requestedStart ?? 0;
      end = requestedEnd === null ? end : Math.min(requestedEnd, end);
    }

    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start > end || start >= fileStat.size) {
      return new Response(null, {
        status: 416,
        headers: { "Content-Range": `bytes */${fileStat.size}` },
      });
    }
    status = 206;
  }

  const contentLength = end - start + 1;
  const headers = backupFileHeaders(fileName, contentLength);
  if (status === 206) {
    Object.assign(headers, { "Content-Range": `bytes ${start}-${end}/${fileStat.size}` });
  }
  console.info(`[backup-export:${id}] file response ready`, {
    fileName,
    bytes: contentLength,
    range: status === 206 ? `${start}-${end}` : null,
  });

  const stream = createReadStream(filePath, { start, end });
  return new Response(Readable.toWeb(stream) as ReadableStream<Uint8Array>, {
    status,
    headers,
  });
}

export function startBackupJob(options: BackupJobOptions = {}) {
  cleanupJobs();
  const id = randomUUID();
  const job: BackupJob = {
    id,
    kind: "backup",
    status: "running",
    phase: "preparing",
    progressPercent: 0,
    processedImages: 0,
    totalImages: 0,
    processedBytes: 0,
    totalBytes: 0,
    error: null,
    result: null,
    createdAt: now(),
    updatedAt: now(),
  };
  jobs.set(id, job);
  console.info(`[backup-export:${id}] job started`, { indexId: options.indexId ?? null });

  void (async () => {
    const resultFilePath = backupJobFilePath(id);
    const resultMetadataFilePath = backupJobMetadataFilePath(id);
    try {
      await mkdir(backupDirectory, { recursive: true });
      const backup = await createBackupZip({
        indexId: options.indexId,
        onImageProgress(progress) {
          job.phase = "collecting-images";
          job.processedImages = progress.processedImages;
          job.totalImages = progress.totalImages;
          touch(job);
        },
        onPackingProgress(progress) {
          job.phase = "packing";
          job.processedBytes = progress.processedBytes;
          job.totalBytes = progress.totalBytes;
          job.progressPercent = progress.totalBytes > 0
            ? Math.min(99, Math.floor((progress.processedBytes / progress.totalBytes) * 100))
            : 0;
          touch(job);
        },
      });

      job.phase = "packing";
      touch(job);
      console.info(`[backup-export:${id}] packing started`, {
        processedImages: job.processedImages,
        totalImages: job.totalImages,
        fileName: backup.fileName,
      });

      await pipeline(backup.stream, createWriteStream(resultFilePath, { flags: "wx" }));
      const resultFileStat = await stat(resultFilePath);
      const record: BackupRecord = {
        id,
        fileName: backup.fileName,
        sizeBytes: resultFileStat.size,
        createdAt: new Date(job.createdAt).toISOString(),
        imageCount: job.totalImages,
        indexId: options.indexId ?? null,
      };
      await writeFile(
        resultMetadataFilePath,
        JSON.stringify(record),
        { encoding: "utf8", flag: "wx" },
      );
      job.status = "completed";
      job.phase = "completed";
      job.progressPercent = 100;
      job.result = {
        fileName: backup.fileName,
        sizeBytes: resultFileStat.size,
      };
      touch(job);
      console.info(`[backup-export:${id}] job completed`, {
        processedImages: job.processedImages,
        totalImages: job.totalImages,
        fileName: backup.fileName,
        bytes: resultFileStat.size,
      });
    } catch (error) {
      await unlink(resultFilePath).catch(() => {});
      await unlink(resultMetadataFilePath).catch(() => {});
      job.status = "failed";
      job.phase = "failed";
      job.error = errorMessage(error);
      touch(job);
      console.error(`[backup-export:${id}] job failed`, {
        error: job.error,
        stack: error instanceof Error ? error.stack : undefined,
        processedImages: job.processedImages,
        totalImages: job.totalImages,
        indexId: options.indexId ?? null,
      });
    }
  })();

  return job;
}

export function startRestoreJobFromFile(filePath: string) {
  cleanupJobs();
  const id = randomUUID();
  const job: RestoreJob = {
    id,
    kind: "restore",
    status: "running",
    phase: "reading-zip",
    progressPercent: 0,
    processedImages: 0,
    totalImages: 0,
    error: null,
    result: null,
    createdAt: now(),
    updatedAt: now(),
  };
  jobs.set(id, job);

  void (async () => {
    try {
      const stats = await restoreBackupZipFromFile(filePath, {
        log(message, metadata) {
          if (message === "manifest loaded") {
            job.phase = "restoring-indexes";
            job.totalImages = Number(metadata?.images ?? 0);
            touch(job);
          }
          if (message === "image restore started") {
            job.phase = "restoring-images";
            job.totalImages = Number(metadata?.images ?? job.totalImages);
            touch(job);
          }
        },
        onImageProgress(progress) {
          job.phase = "restoring-images";
          job.processedImages = progress.processedImages;
          job.totalImages = progress.totalImages;
          job.progressPercent = progress.totalImages > 0
            ? Math.min(99, Math.round((progress.processedImages / progress.totalImages) * 100))
            : 0;
          touch(job);
        },
      });

      job.status = "completed";
      job.phase = "completed";
      job.progressPercent = 100;
      job.result = stats;
      touch(job);
    } catch (error) {
      job.status = "failed";
      job.phase = "failed";
      job.error = errorMessage(error);
      touch(job);
      console.error(`[backup-restore:${job.id}] job failed`, {
        error: job.error,
        stack: error instanceof Error ? error.stack : undefined,
      });
    } finally {
      await unlink(filePath).catch(() => {});
    }
  })();

  return job;
}
