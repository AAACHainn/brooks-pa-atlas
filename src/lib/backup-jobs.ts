import { randomUUID } from "node:crypto";

import { createBackupZip, restoreBackupZip } from "@/lib/backup";

type JobStatus = "running" | "completed" | "failed";
type JobKind = "backup" | "restore";

type BackupJobResult = {
  fileName: string;
  buffer: Buffer;
};

type RestoreJobResult = Awaited<ReturnType<typeof restoreBackupZip>>;

type BackupJob = {
  id: string;
  kind: "backup";
  status: JobStatus;
  phase: string;
  processedImages: number;
  totalImages: number;
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
  processedImages: number;
  totalImages: number;
  error: string | null;
  result: RestoreJobResult | null;
  createdAt: number;
  updatedAt: number;
};

export type BackupTaskJob = BackupJob | RestoreJob;

type JobStore = Map<string, BackupTaskJob>;

const jobTtlMs = 30 * 60 * 1000;

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

function streamToBuffer(stream: ReadableStream<Uint8Array>) {
  return new Response(stream).arrayBuffer().then((arrayBuffer) => Buffer.from(arrayBuffer));
}

function publicJob(job: BackupTaskJob) {
  return {
    id: job.id,
    kind: job.kind,
    status: job.status,
    phase: job.phase,
    processedImages: job.processedImages,
    totalImages: job.totalImages,
    error: job.error,
    fileName: job.kind === "backup" ? job.result?.fileName ?? null : null,
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

export function startBackupJob() {
  cleanupJobs();
  const id = randomUUID();
  const job: BackupJob = {
    id,
    kind: "backup",
    status: "running",
    phase: "preparing",
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
      const backup = await createBackupZip({
        onImageProgress(progress) {
          job.phase = "collecting-images";
          job.processedImages = progress.processedImages;
          job.totalImages = progress.totalImages;
          touch(job);
        },
      });

      job.phase = "packing";
      touch(job);

      const buffer = await streamToBuffer(backup.stream);
      job.status = "completed";
      job.phase = "completed";
      job.result = {
        fileName: backup.fileName,
        buffer,
      };
      touch(job);
    } catch (error) {
      job.status = "failed";
      job.phase = "failed";
      job.error = errorMessage(error);
      touch(job);
    }
  })();

  return job;
}

export function startRestoreJob(buffer: Buffer) {
  cleanupJobs();
  const id = randomUUID();
  const job: RestoreJob = {
    id,
    kind: "restore",
    status: "running",
    phase: "reading-zip",
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
      const stats = await restoreBackupZip(buffer, {
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
          touch(job);
        },
      });

      job.status = "completed";
      job.phase = "completed";
      job.result = stats;
      touch(job);
    } catch (error) {
      job.status = "failed";
      job.phase = "failed";
      job.error = errorMessage(error);
      touch(job);
    }
  })();

  return job;
}
