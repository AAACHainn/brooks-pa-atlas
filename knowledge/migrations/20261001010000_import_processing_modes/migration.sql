ALTER TABLE "KnowledgeImportJob" ADD COLUMN "processingMode" TEXT NOT NULL DEFAULT 'AI';

ALTER TABLE "KnowledgeImportItem" ADD COLUMN "cacheHit" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "KnowledgeDocumentVersion" ADD COLUMN "processingMode" TEXT NOT NULL DEFAULT 'AI';
ALTER TABLE "KnowledgeDocumentVersion" ADD COLUMN "processingRuleVersion" TEXT NOT NULL DEFAULT 'legacy-v1';
ALTER TABLE "KnowledgeDocumentVersion" ADD COLUMN "cacheSourceVersionId" TEXT;

ALTER TABLE "KnowledgeProcessingWindow" ADD COLUMN "inputTokens" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "KnowledgeProcessingWindow" ADD COLUMN "outputTokens" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX "KnowledgeDocumentVersion_processing_cache_idx"
ON "KnowledgeDocumentVersion"(
  "sourceHash", "processingMode", "processingRuleVersion", "processorModel", "processorPromptHash"
);
