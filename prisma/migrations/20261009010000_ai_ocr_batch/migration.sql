CREATE TABLE "AiOcrBatchJob" (
 "id" TEXT NOT NULL PRIMARY KEY, "activeKey" TEXT, "indexNodeId" TEXT NOT NULL, "indexPath" TEXT NOT NULL,
 "scopeJson" TEXT NOT NULL, "mode" TEXT NOT NULL, "status" TEXT NOT NULL, "revision" INTEGER NOT NULL DEFAULT 0,
 "runId" TEXT, "configFingerprint" TEXT NOT NULL, "endpointName" TEXT NOT NULL, "model" TEXT NOT NULL,
 "totalImages" INTEGER NOT NULL, "completedImages" INTEGER NOT NULL DEFAULT 0, "failedImages" INTEGER NOT NULL DEFAULT 0,
 "skippedImages" INTEGER NOT NULL DEFAULT 0, "requests" INTEGER NOT NULL DEFAULT 0, "estimatedInputTokens" INTEGER NOT NULL DEFAULT 0,
 "reportedInputTokens" INTEGER NOT NULL DEFAULT 0, "reportedOutputTokens" INTEGER NOT NULL DEFAULT 0,
 "inputReportedRequests" INTEGER NOT NULL DEFAULT 0, "outputReportedRequests" INTEGER NOT NULL DEFAULT 0,
 "error" TEXT, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL, "finishedAt" DATETIME
);
CREATE UNIQUE INDEX "AiOcrBatchJob_activeKey_key" ON "AiOcrBatchJob"("activeKey");
CREATE TABLE "AiOcrBatchItem" (
 "id" TEXT NOT NULL PRIMARY KEY, "jobId" TEXT NOT NULL, "chartImageId" TEXT, "sourceImageId" TEXT NOT NULL,
 "originalName" TEXT NOT NULL, "ordinal" INTEGER NOT NULL, "sourceFingerprint" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'PENDING',
 "attempts" INTEGER NOT NULL DEFAULT 0, "estimatedInputTokens" INTEGER NOT NULL DEFAULT 0,
 "reportedInputTokens" INTEGER, "reportedOutputTokens" INTEGER, "finishReason" TEXT, "error" TEXT,
 FOREIGN KEY ("jobId") REFERENCES "AiOcrBatchJob"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 FOREIGN KEY ("chartImageId") REFERENCES "ChartImage"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "AiOcrBatchItem_jobId_sourceImageId_key" ON "AiOcrBatchItem"("jobId", "sourceImageId");
CREATE INDEX "AiOcrBatchItem_jobId_status_ordinal_idx" ON "AiOcrBatchItem"("jobId", "status", "ordinal");
CREATE INDEX "AiOcrBatchItem_chartImageId_idx" ON "AiOcrBatchItem"("chartImageId");
CREATE TABLE "AiOcrBatchPreview" (
 "token" TEXT NOT NULL PRIMARY KEY, "indexNodeId" TEXT NOT NULL, "jobId" TEXT, "action" TEXT NOT NULL,
 "revision" INTEGER, "fingerprint" TEXT NOT NULL, "expiresAt" DATETIME NOT NULL, "consumedJobId" TEXT
);
