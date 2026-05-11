import { randomUUID } from "node:crypto";

import type { DocumentImporter, DocumentImportResult } from "@/lib/document-importers";

type JobStatus = "running" | "completed" | "failed";

type DocumentImportJob = {
  id: string;
  kind: string;
  status: JobStatus;
  phase: string;
  processedPages: number;
  totalPages: number;
  imported: number;
  failed: number;
  duplicate: number;
  batchId: string | null;
  error: string | null;
  result: DocumentImportResult | null;
  createdAt: number;
  updatedAt: number;
};

type JobStore = Map<string, DocumentImportJob>;

const jobTtlMs = 30 * 60 * 1000;

const globalForDocumentImportJobs = globalThis as typeof globalThis & {
  brooksDocumentImportJobs?: JobStore;
};

const jobs = globalForDocumentImportJobs.brooksDocumentImportJobs ?? new Map<string, DocumentImportJob>();
globalForDocumentImportJobs.brooksDocumentImportJobs = jobs;

function now() {
  return Date.now();
}

function touch(job: DocumentImportJob) {
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

export function serializeDocumentImportJob(job: DocumentImportJob) {
  return {
    id: job.id,
    kind: job.kind,
    status: job.status,
    phase: job.phase,
    processedPages: job.processedPages,
    totalPages: job.totalPages,
    imported: job.imported,
    failed: job.failed,
    duplicate: job.duplicate,
    batchId: job.batchId,
    error: job.error,
  };
}

export function getDocumentImportJob(id: string) {
  cleanupJobs();
  return jobs.get(id) ?? null;
}

export function startDocumentImportJob({
  importer,
  file,
  buffer,
  baseIndexPath,
}: {
  importer: DocumentImporter;
  file: File;
  buffer: Buffer;
  baseIndexPath: string[];
}) {
  cleanupJobs();
  const id = randomUUID();
  const job: DocumentImportJob = {
    id,
    kind: importer.kind,
    status: "running",
    phase: "queued",
    processedPages: 0,
    totalPages: 0,
    imported: 0,
    failed: 0,
    duplicate: 0,
    batchId: null,
    error: null,
    result: null,
    createdAt: now(),
    updatedAt: now(),
  };
  jobs.set(id, job);

  void (async () => {
    try {
      job.phase = "importing";
      touch(job);

      const result = await importer.importDocument({
        file,
        buffer,
        baseIndexPath,
        onProgress(progress) {
          job.phase = "importing";
          job.batchId = progress.batchId;
          job.totalPages = progress.totalCount;
          job.processedPages = progress.processedCount;
          job.imported = progress.imported;
          job.failed = progress.failed;
          job.duplicate = progress.duplicate;
          touch(job);
        },
      });

      job.status = "completed";
      job.phase = "completed";
      job.result = result;
      job.batchId = result.batchId;
      job.totalPages = result.totalCount;
      job.processedPages = result.processedCount;
      job.imported = result.imported;
      job.failed = result.failed;
      job.duplicate = result.duplicate;
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
