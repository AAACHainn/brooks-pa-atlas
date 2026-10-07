CREATE TABLE "AiRobotConversation" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "title" TEXT,
  "nextTurn" INTEGER NOT NULL DEFAULT 0,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL
);
CREATE TABLE "AiRobotMessage" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "conversationId" TEXT NOT NULL,
  "role" TEXT NOT NULL CHECK ("role" IN ('USER', 'ASSISTANT')),
  "sequence" INTEGER NOT NULL,
  "content" TEXT NOT NULL,
  "selectionJson" TEXT,
  "reasoningContent" TEXT,
  "reasoningDurationMs" INTEGER,
  "executionJson" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AiRobotMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "AiRobotConversation" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "AiRobotConversation_updatedAt_idx" ON "AiRobotConversation"("updatedAt");
CREATE UNIQUE INDEX "AiRobotMessage_conversationId_sequence_key" ON "AiRobotMessage"("conversationId", "sequence");
CREATE INDEX "AiRobotMessage_conversationId_createdAt_idx" ON "AiRobotMessage"("conversationId", "createdAt");
