ALTER TABLE "KnowledgeImportItem" ADD COLUMN "progressCompleted" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "KnowledgeImportItem" ADD COLUMN "progressTotal" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "KnowledgeImportItem" ADD COLUMN "progressUnit" TEXT;
ALTER TABLE "KnowledgeImportItem" ADD COLUMN "stageStartedAt" DATETIME;
ALTER TABLE "KnowledgeImportItem" ADD COLUMN "lastProgressAt" DATETIME;
ALTER TABLE "KnowledgeImportItem" ADD COLUMN "errorPhase" TEXT;

ALTER TABLE "KnowledgeProcessingWindow" ADD COLUMN "startedAt" DATETIME;
ALTER TABLE "KnowledgeProcessingWindow" ADD COLUMN "finishedAt" DATETIME;
