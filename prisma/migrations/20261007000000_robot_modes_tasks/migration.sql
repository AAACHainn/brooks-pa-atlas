ALTER TABLE "AiRobotConversation" ADD COLUMN "mode" TEXT NOT NULL DEFAULT 'normal';
CREATE TABLE "AiRobotTask" (
 "id" TEXT NOT NULL PRIMARY KEY, "conversationId" TEXT NOT NULL, "goal" TEXT NOT NULL,
 "locale" TEXT NOT NULL DEFAULT 'zh', "status" TEXT NOT NULL DEFAULT 'planning',
 "revision" INTEGER NOT NULL DEFAULT 0, "planVersion" INTEGER NOT NULL DEFAULT 0, "currentStep" INTEGER NOT NULL DEFAULT 0,
 "selectionJson" TEXT NOT NULL, "planJson" TEXT, "manifestJson" TEXT,
 "budgetJson" TEXT NOT NULL DEFAULT '{}', "result" TEXT, "error" TEXT, "runId" TEXT,
 "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL,
 FOREIGN KEY ("conversationId") REFERENCES "AiRobotConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "AiRobotTask_conversationId_createdAt_idx" ON "AiRobotTask"("conversationId", "createdAt");
CREATE TABLE "AiRobotTaskCheckpoint" (
 "id" TEXT NOT NULL PRIMARY KEY, "taskId" TEXT NOT NULL, "ordinal" INTEGER NOT NULL,
 "inputJson" TEXT NOT NULL, "resultJson" TEXT NOT NULL, "budgetJson" TEXT NOT NULL,
 "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY ("taskId") REFERENCES "AiRobotTask"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "AiRobotTaskCheckpoint_taskId_ordinal_key" ON "AiRobotTaskCheckpoint"("taskId", "ordinal");
