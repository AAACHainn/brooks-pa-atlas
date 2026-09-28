import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { unlink } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";

const require = createRequire(import.meta.url);
const Database = require("better-sqlite3") as new (filePath: string) => {
  exec(sql: string): void;
  close(): void;
};

test("batch OCR snapshots one index subtree, requires overwrite confirmation, and tracks only its items", async () => {
  const databasePath = path.join(process.cwd(), `.ocr-batch-test-${randomUUID()}.db`);
  const migrationsRoot = path.join(process.cwd(), "prisma", "migrations");
  const database = new Database(databasePath);
  try {
    for (const migrationId of readdirSync(migrationsRoot).sort()) {
      const migrationPath = path.join(migrationsRoot, migrationId, "migration.sql");
      database.exec(readFileSync(migrationPath, "utf8"));
    }
  } finally {
    database.close();
  }

  process.env.DATABASE_URL = `file:${databasePath.replace(/\\/g, "/")}`;
  const { prisma } = await import("@/lib/db");
  const {
    getIndexOcrBatchSummary,
    markOcrBatchItemRunning,
    OcrBatchJobRequestError,
    settleOcrBatchItem,
    startIndexOcrBatchJob,
  } = await import("@/lib/ocr-batch-jobs");

  try {
    await prisma.indexNode.createMany({
      data: [
        { id: "root", name: "Root", parentId: null, depth: 0, path: "Root", sortOrder: 0 },
        { id: "child", name: "Child", parentId: "root", depth: 1, path: "Root / Child", sortOrder: 0 },
        { id: "other", name: "Other", parentId: null, depth: 0, path: "Other", sortOrder: 1 },
      ],
    });
    await prisma.chartImage.createMany({
      data: [
        {
          id: "image-root",
          libraryPath: "images/root.png",
          originalName: "root.png",
          mimeType: "image/png",
          sizeBytes: 10,
          hash: "hash-root",
          ocrText: "existing text",
          ocrStatus: "COMPLETED",
          indexNodeId: "root",
        },
        {
          id: "image-child",
          libraryPath: "images/child.png",
          originalName: "child.png",
          mimeType: "image/png",
          sizeBytes: 10,
          hash: "hash-child",
          ocrStatus: "SKIPPED",
          indexNodeId: "child",
        },
        {
          id: "image-other",
          libraryPath: "images/other.png",
          originalName: "other.png",
          mimeType: "image/png",
          sizeBytes: 10,
          hash: "hash-other",
          ocrStatus: "SKIPPED",
          indexNodeId: "other",
        },
      ],
    });

    const summary = await getIndexOcrBatchSummary("root");
    assert.deepEqual(summary, {
      indexNodeId: "root",
      indexPath: "Root",
      totalImages: 2,
      existingTextImages: 1,
      withoutTextImages: 1,
      requiresTypedConfirmation: true,
    });

    await assert.rejects(
      () => startIndexOcrBatchJob("root"),
      (error) => error instanceof OcrBatchJobRequestError && error.code === "CONFIRMATION_REQUIRED",
    );

    const job = await startIndexOcrBatchJob("root", "确认重新OCR");
    assert.equal(job.totalImages, 2);
    assert.equal(await prisma.ocrBatchJobItem.count({ where: { jobId: job.id } }), 2);
    assert.equal(
      await prisma.ocrBatchJobItem.count({ where: { jobId: job.id, sourceImageId: "image-other" } }),
      0,
    );

    await assert.rejects(
      () => startIndexOcrBatchJob("other"),
      (error) => error instanceof OcrBatchJobRequestError && error.code === "ACTIVE_JOB_EXISTS",
    );

    await markOcrBatchItemRunning("image-root");
    await settleOcrBatchItem("image-root", "COMPLETED");
    await settleOcrBatchItem("image-child", "FAILED", "fixture failure");

    const completedJob = await prisma.ocrBatchJob.findUniqueOrThrow({ where: { id: job.id } });
    assert.equal(completedJob.status, "COMPLETED_WITH_ERRORS");
    assert.equal(completedJob.processedImages, 2);
    assert.equal(completedJob.completedImages, 1);
    assert.equal(completedJob.failedImages, 1);
    assert.equal(completedJob.activeKey, null);
    assert.equal(
      (await prisma.chartImage.findUniqueOrThrow({ where: { id: "image-root" } })).ocrText,
      "existing text",
    );
  } finally {
    await prisma.$disconnect();
    await unlink(databasePath);
    delete process.env.DATABASE_URL;
  }
});
