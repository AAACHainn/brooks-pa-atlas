CREATE TABLE "OcrBatchJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "activeKey" TEXT,
    "indexNodeId" TEXT NOT NULL,
    "indexPath" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "totalImages" INTEGER NOT NULL DEFAULT 0,
    "processedImages" INTEGER NOT NULL DEFAULT 0,
    "completedImages" INTEGER NOT NULL DEFAULT 0,
    "failedImages" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE TABLE "OcrBatchJobItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "jobId" TEXT NOT NULL,
    "chartImageId" TEXT,
    "sourceImageId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "error" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "OcrBatchJobItem_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "OcrBatchJob" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "OcrBatchJobItem_chartImageId_fkey" FOREIGN KEY ("chartImageId") REFERENCES "ChartImage" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "OcrBatchJob_activeKey_key" ON "OcrBatchJob"("activeKey");
CREATE INDEX "OcrBatchJob_status_idx" ON "OcrBatchJob"("status");
CREATE INDEX "OcrBatchJob_createdAt_idx" ON "OcrBatchJob"("createdAt");
CREATE UNIQUE INDEX "OcrBatchJobItem_jobId_sourceImageId_key" ON "OcrBatchJobItem"("jobId", "sourceImageId");
CREATE INDEX "OcrBatchJobItem_jobId_status_idx" ON "OcrBatchJobItem"("jobId", "status");
CREATE INDEX "OcrBatchJobItem_chartImageId_idx" ON "OcrBatchJobItem"("chartImageId");
