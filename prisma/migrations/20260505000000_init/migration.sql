-- CreateTable
CREATE TABLE "IndexNode" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "parentId" TEXT,
    "depth" INTEGER NOT NULL DEFAULT 0,
    "path" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "IndexNode_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "IndexNode" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ChartImage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "libraryPath" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "hash" TEXT NOT NULL,
    "title" TEXT,
    "notes" TEXT,
    "ocrText" TEXT,
    "ocrStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "ocrError" TEXT,
    "ocrUpdatedAt" DATETIME,
    "indexNodeId" TEXT,
    "importBatchId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ChartImage_indexNodeId_fkey" FOREIGN KEY ("indexNodeId") REFERENCES "IndexNode" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ChartImage_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "ImportBatch" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ImportBatch" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "totalCount" INTEGER NOT NULL DEFAULT 0,
    "successCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "duplicateCount" INTEGER NOT NULL DEFAULT 0,
    "ocrPendingCount" INTEGER NOT NULL DEFAULT 0,
    "ocrCompletedCount" INTEGER NOT NULL DEFAULT 0,
    "ocrFailedCount" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "ImportItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "batchId" TEXT NOT NULL,
    "chartImageId" TEXT,
    "indexNodeId" TEXT,
    "originalName" TEXT NOT NULL,
    "relativePath" TEXT,
    "savedPath" TEXT,
    "groupKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "error" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ImportItem_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "ImportBatch" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ImportItem_chartImageId_fkey" FOREIGN KEY ("chartImageId") REFERENCES "ChartImage" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ImportItem_indexNodeId_fkey" FOREIGN KEY ("indexNodeId") REFERENCES "IndexNode" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AppSetting" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "IndexNode_parentId_idx" ON "IndexNode"("parentId");

-- CreateIndex
CREATE INDEX "IndexNode_path_idx" ON "IndexNode"("path");

-- CreateIndex
CREATE UNIQUE INDEX "IndexNode_parentId_name_key" ON "IndexNode"("parentId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "ChartImage_libraryPath_key" ON "ChartImage"("libraryPath");

-- CreateIndex
CREATE UNIQUE INDEX "ChartImage_hash_key" ON "ChartImage"("hash");

-- CreateIndex
CREATE INDEX "ChartImage_indexNodeId_idx" ON "ChartImage"("indexNodeId");

-- CreateIndex
CREATE INDEX "ChartImage_importBatchId_idx" ON "ChartImage"("importBatchId");

-- CreateIndex
CREATE INDEX "ChartImage_ocrStatus_idx" ON "ChartImage"("ocrStatus");

-- CreateIndex
CREATE INDEX "ChartImage_originalName_idx" ON "ChartImage"("originalName");

-- CreateIndex
CREATE INDEX "ImportBatch_status_idx" ON "ImportBatch"("status");

-- CreateIndex
CREATE INDEX "ImportBatch_createdAt_idx" ON "ImportBatch"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ImportItem_chartImageId_key" ON "ImportItem"("chartImageId");

-- CreateIndex
CREATE INDEX "ImportItem_batchId_idx" ON "ImportItem"("batchId");

-- CreateIndex
CREATE INDEX "ImportItem_indexNodeId_idx" ON "ImportItem"("indexNodeId");

-- CreateIndex
CREATE INDEX "ImportItem_status_idx" ON "ImportItem"("status");

-- CreateIndex
CREATE INDEX "ImportItem_groupKey_idx" ON "ImportItem"("groupKey");

-- CreateIndex
CREATE UNIQUE INDEX "AppSetting_key_key" ON "AppSetting"("key");
