CREATE TABLE "AiReadingConversation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT,
    "nextTurn" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE TABLE "AiReadingMessage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "conversationId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "chartImageId" TEXT,
    "imageContextJson" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AiReadingMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "AiReadingConversation" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AiReadingMessage_chartImageId_fkey" FOREIGN KEY ("chartImageId") REFERENCES "ChartImage" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "AiReadingConversation_updatedAt_idx" ON "AiReadingConversation"("updatedAt");
CREATE INDEX "AiReadingMessage_conversationId_createdAt_idx" ON "AiReadingMessage"("conversationId", "createdAt");
CREATE INDEX "AiReadingMessage_chartImageId_idx" ON "AiReadingMessage"("chartImageId");
CREATE UNIQUE INDEX "AiReadingMessage_conversationId_sequence_key" ON "AiReadingMessage"("conversationId", "sequence");
