ALTER TABLE "KnowledgeDocument" ADD COLUMN "sourceType" TEXT NOT NULL DEFAULT 'SUBTITLE';
ALTER TABLE "KnowledgeDocument" ADD COLUMN "enabled" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "KnowledgeDocumentVersion" ADD COLUMN "sourceFormat" TEXT NOT NULL DEFAULT 'OTHER';
ALTER TABLE "KnowledgeImportItem" ADD COLUMN "sourceType" TEXT NOT NULL DEFAULT 'SUBTITLE';

UPDATE "KnowledgeDocumentVersion"
SET "sourceFormat" = CASE
  WHEN lower("sourceFileName") LIKE '%.srt' THEN 'SRT'
  WHEN lower("sourceFileName") LIKE '%.vtt' THEN 'VTT'
  WHEN lower("sourceFileName") LIKE '%.ass' THEN 'ASS'
  WHEN lower("sourceFileName") LIKE '%.txt' THEN 'TXT'
  WHEN lower("sourceFileName") LIKE '%.md' OR lower("sourceFileName") LIKE '%.markdown' THEN 'MARKDOWN'
  WHEN lower("sourceFileName") LIKE '%.pdf' THEN 'PDF'
  WHEN lower("sourceFileName") LIKE '%.epub' THEN 'EPUB'
  WHEN lower("sourceFileName") LIKE '%.docx' THEN 'DOCX'
  WHEN lower("sourceFileName") LIKE '%.htm' OR lower("sourceFileName") LIKE '%.html' THEN 'HTML'
  ELSE 'OTHER'
END;

ALTER TABLE "KnowledgeChunk" ADD COLUMN "locatorKind" TEXT NOT NULL DEFAULT 'SUBTITLE';
ALTER TABLE "KnowledgeChunk" ADD COLUMN "locatorJson" TEXT NOT NULL DEFAULT '{}';

UPDATE "KnowledgeChunk"
SET "locatorKind" = 'SUBTITLE',
    "locatorJson" = json_object(
      'v', 1,
      'kind', 'subtitle',
      'cueStart', "sourceCueStart",
      'cueEnd', "sourceCueEnd",
      'startMs', "startMs",
      'endMs', "endMs"
    );

CREATE TABLE "KnowledgeDocumentBinding" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "documentId" TEXT NOT NULL,
  "indexNodeId" TEXT,
  "indexPathSnapshot" TEXT NOT NULL,
  "appliesToDescendants" INTEGER NOT NULL DEFAULT 1,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE' CHECK ("status" IN ('ACTIVE', 'ORPHANED')),
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "KnowledgeDocumentBinding_documentId_fkey"
    FOREIGN KEY ("documentId") REFERENCES "KnowledgeDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "KnowledgeDocumentBinding_documentId_key"
ON "KnowledgeDocumentBinding"("documentId");
CREATE UNIQUE INDEX "KnowledgeDocumentBinding_indexNodeId_key"
ON "KnowledgeDocumentBinding"("indexNodeId") WHERE "indexNodeId" IS NOT NULL;
CREATE INDEX "KnowledgeDocumentBinding_status_idx"
ON "KnowledgeDocumentBinding"("status");

INSERT INTO "KnowledgeDocumentBinding"
  ("id", "documentId", "indexNodeId", "indexPathSnapshot", "appliesToDescendants", "status")
SELECT lower(hex(randomblob(16))), "id", "indexNodeId", "indexPathSnapshot", "appliesToDescendants",
  CASE WHEN "bindingStatus" = 'ORPHANED' OR "indexNodeId" IS NULL THEN 'ORPHANED' ELSE 'ACTIVE' END
FROM "KnowledgeDocument";

UPDATE "KnowledgeDocument"
SET "enabled" = CASE WHEN "bindingStatus" = 'DISABLED' THEN 0 ELSE 1 END;

DROP INDEX "KnowledgeDocument_indexNodeId_key";
DROP INDEX "KnowledgeDocument_bindingStatus_idx";
ALTER TABLE "KnowledgeDocument" DROP COLUMN "indexNodeId";
ALTER TABLE "KnowledgeDocument" DROP COLUMN "indexPathSnapshot";
ALTER TABLE "KnowledgeDocument" DROP COLUMN "appliesToDescendants";
ALTER TABLE "KnowledgeDocument" DROP COLUMN "bindingStatus";
