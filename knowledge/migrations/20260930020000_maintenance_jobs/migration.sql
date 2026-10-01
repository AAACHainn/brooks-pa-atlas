CREATE TABLE "KnowledgeMaintenanceJob" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "activeKey" TEXT,
  "kind" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'RUNNING',
  "endpointId" TEXT,
  "model" TEXT,
  "profileId" TEXT,
  "totalItems" INTEGER NOT NULL DEFAULT 0,
  "processedItems" INTEGER NOT NULL DEFAULT 0,
  "error" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedAt" DATETIME,
  CONSTRAINT "KnowledgeMaintenanceJob_profileId_fkey"
    FOREIGN KEY ("profileId") REFERENCES "KnowledgeEmbeddingProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "KnowledgeMaintenanceJob_activeKey_key"
ON "KnowledgeMaintenanceJob"("activeKey") WHERE "activeKey" IS NOT NULL;
