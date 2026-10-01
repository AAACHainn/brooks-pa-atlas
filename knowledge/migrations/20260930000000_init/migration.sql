PRAGMA foreign_keys = ON;

CREATE TABLE "KnowledgeDocument" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "title" TEXT NOT NULL,
  "lessonCode" TEXT,
  "normalizedLessonCode" TEXT,
  "indexNodeId" TEXT,
  "indexPathSnapshot" TEXT NOT NULL,
  "appliesToDescendants" INTEGER NOT NULL DEFAULT 1,
  "bindingStatus" TEXT NOT NULL DEFAULT 'ACTIVE',
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX "KnowledgeDocument_indexNodeId_key"
ON "KnowledgeDocument"("indexNodeId") WHERE "indexNodeId" IS NOT NULL;
CREATE INDEX "KnowledgeDocument_lessonCode_idx" ON "KnowledgeDocument"("normalizedLessonCode");
CREATE INDEX "KnowledgeDocument_bindingStatus_idx" ON "KnowledgeDocument"("bindingStatus");

CREATE TABLE "KnowledgeDocumentVersion" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "documentId" TEXT NOT NULL,
  "versionNumber" INTEGER NOT NULL,
  "sourceFileName" TEXT NOT NULL,
  "sourceMimeType" TEXT NOT NULL,
  "sourceSizeBytes" INTEGER NOT NULL,
  "sourceHash" TEXT NOT NULL,
  "sourcePath" TEXT NOT NULL,
  "rawText" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PROCESSING',
  "approvalMode" TEXT NOT NULL DEFAULT 'AUTO',
  "processorEndpointId" TEXT,
  "processorModel" TEXT,
  "processorPromptHash" TEXT,
  "error" TEXT,
  "activatedAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "KnowledgeDocumentVersion_documentId_fkey"
    FOREIGN KEY ("documentId") REFERENCES "KnowledgeDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "KnowledgeDocumentVersion_documentId_versionNumber_key"
ON "KnowledgeDocumentVersion"("documentId", "versionNumber");
CREATE UNIQUE INDEX "KnowledgeDocumentVersion_active_document_key"
ON "KnowledgeDocumentVersion"("documentId") WHERE "status" = 'ACTIVE';
CREATE INDEX "KnowledgeDocumentVersion_status_idx" ON "KnowledgeDocumentVersion"("status");
CREATE INDEX "KnowledgeDocumentVersion_sourceHash_idx" ON "KnowledgeDocumentVersion"("sourceHash");

CREATE TABLE "KnowledgeChunk" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "versionId" TEXT NOT NULL,
  "ordinal" INTEGER NOT NULL,
  "sourceCueStart" INTEGER NOT NULL,
  "sourceCueEnd" INTEGER NOT NULL,
  "startMs" INTEGER,
  "endMs" INTEGER,
  "originalText" TEXT NOT NULL,
  "cleanedText" TEXT NOT NULL,
  "topic" TEXT NOT NULL DEFAULT '',
  "keywordsJson" TEXT NOT NULL DEFAULT '[]',
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "KnowledgeChunk_versionId_fkey"
    FOREIGN KEY ("versionId") REFERENCES "KnowledgeDocumentVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "KnowledgeChunk_versionId_ordinal_key"
ON "KnowledgeChunk"("versionId", "ordinal");
CREATE INDEX "KnowledgeChunk_versionId_idx" ON "KnowledgeChunk"("versionId");

CREATE TABLE "KnowledgeEmbeddingProfile" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "endpointId" TEXT NOT NULL,
  "model" TEXT NOT NULL,
  "dimensions" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "error" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX "KnowledgeEmbeddingProfile_active_key"
ON "KnowledgeEmbeddingProfile"("status") WHERE "status" = 'ACTIVE';

CREATE TABLE "KnowledgeChunkEmbedding" (
  "chunkId" TEXT NOT NULL,
  "profileId" TEXT NOT NULL,
  "embedding" BLOB NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("chunkId", "profileId"),
  CONSTRAINT "KnowledgeChunkEmbedding_chunkId_fkey"
    FOREIGN KEY ("chunkId") REFERENCES "KnowledgeChunk"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "KnowledgeChunkEmbedding_profileId_fkey"
    FOREIGN KEY ("profileId") REFERENCES "KnowledgeEmbeddingProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "KnowledgeChunkEmbedding_profileId_idx"
ON "KnowledgeChunkEmbedding"("profileId");

CREATE TABLE "KnowledgeChunkKeyword" (
  "chunkId" TEXT NOT NULL,
  "keyword" TEXT NOT NULL,
  "normalizedKeyword" TEXT NOT NULL,
  PRIMARY KEY ("chunkId", "normalizedKeyword"),
  CONSTRAINT "KnowledgeChunkKeyword_chunkId_fkey"
    FOREIGN KEY ("chunkId") REFERENCES "KnowledgeChunk"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "KnowledgeChunkKeyword_normalizedKeyword_idx"
ON "KnowledgeChunkKeyword"("normalizedKeyword");

CREATE TABLE "KnowledgeImportJob" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "activeKey" TEXT,
  "status" TEXT NOT NULL DEFAULT 'RUNNING',
  "phase" TEXT NOT NULL DEFAULT 'QUEUED',
  "manualReview" INTEGER NOT NULL DEFAULT 0,
  "totalItems" INTEGER NOT NULL DEFAULT 0,
  "processedItems" INTEGER NOT NULL DEFAULT 0,
  "completedItems" INTEGER NOT NULL DEFAULT 0,
  "failedItems" INTEGER NOT NULL DEFAULT 0,
  "error" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedAt" DATETIME
);

CREATE UNIQUE INDEX "KnowledgeImportJob_activeKey_key"
ON "KnowledgeImportJob"("activeKey") WHERE "activeKey" IS NOT NULL;
CREATE INDEX "KnowledgeImportJob_status_idx" ON "KnowledgeImportJob"("status");

CREATE TABLE "KnowledgeImportItem" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "jobId" TEXT NOT NULL,
  "sourceFileName" TEXT NOT NULL,
  "sourceMimeType" TEXT NOT NULL,
  "sourceSizeBytes" INTEGER NOT NULL,
  "sourceHash" TEXT NOT NULL,
  "sourcePath" TEXT NOT NULL,
  "targetIndexNodeId" TEXT NOT NULL,
  "targetIndexPath" TEXT NOT NULL,
  "documentId" TEXT,
  "versionId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "phase" TEXT NOT NULL DEFAULT 'QUEUED',
  "retryCount" INTEGER NOT NULL DEFAULT 0,
  "error" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "KnowledgeImportItem_jobId_fkey"
    FOREIGN KEY ("jobId") REFERENCES "KnowledgeImportJob"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "KnowledgeImportItem_documentId_fkey"
    FOREIGN KEY ("documentId") REFERENCES "KnowledgeDocument"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "KnowledgeImportItem_versionId_fkey"
    FOREIGN KEY ("versionId") REFERENCES "KnowledgeDocumentVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "KnowledgeImportItem_jobId_status_idx"
ON "KnowledgeImportItem"("jobId", "status");

CREATE TABLE "KnowledgeProcessingWindow" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "itemId" TEXT NOT NULL,
  "ordinal" INTEGER NOT NULL,
  "cueStart" INTEGER NOT NULL,
  "cueEnd" INTEGER NOT NULL,
  "inputJson" TEXT NOT NULL,
  "outputJson" TEXT,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "retryCount" INTEGER NOT NULL DEFAULT 0,
  "error" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "KnowledgeProcessingWindow_itemId_fkey"
    FOREIGN KEY ("itemId") REFERENCES "KnowledgeImportItem"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "KnowledgeProcessingWindow_itemId_ordinal_key"
ON "KnowledgeProcessingWindow"("itemId", "ordinal");

CREATE VIRTUAL TABLE "KnowledgeChunkFts" USING fts5(
  "chunkId" UNINDEXED,
  "documentId" UNINDEXED,
  "versionId" UNINDEXED,
  "title",
  "lessonCode",
  "topic",
  "keywords",
  "cleanedText",
  tokenize = 'trigram'
);
