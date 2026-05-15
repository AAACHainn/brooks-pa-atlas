-- CreateTable
CREATE TABLE IF NOT EXISTS "ExamPaper" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "defaultOptionsJson" TEXT NOT NULL DEFAULT '[]',
    "publishedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "ExamQuestion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "paperId" TEXT NOT NULL,
    "chartImageId" TEXT NOT NULL,
    "prompt" TEXT NOT NULL DEFAULT '',
    "optionsJson" TEXT NOT NULL DEFAULT '[]',
    "correctOption" TEXT,
    "explanation" TEXT NOT NULL DEFAULT '',
    "maskRectsJson" TEXT NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ExamQuestion_paperId_fkey" FOREIGN KEY ("paperId") REFERENCES "ExamPaper" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ExamQuestion_chartImageId_fkey" FOREIGN KEY ("chartImageId") REFERENCES "ChartImage" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "ExamAttempt" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "paperId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'IN_PROGRESS',
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submittedAt" DATETIME,
    "durationSeconds" INTEGER,
    "totalCount" INTEGER NOT NULL DEFAULT 0,
    "correctCount" INTEGER NOT NULL DEFAULT 0,
    "accuracy" REAL NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ExamAttempt_paperId_fkey" FOREIGN KEY ("paperId") REFERENCES "ExamPaper" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "ExamAttemptAnswer" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "attemptId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "userAnswer" TEXT,
    "isCorrect" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ExamAttemptAnswer_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "ExamAttempt" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ExamAttemptAnswer_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "ExamQuestion" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ExamPaper_status_idx" ON "ExamPaper"("status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ExamPaper_createdAt_idx" ON "ExamPaper"("createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ExamQuestion_paperId_idx" ON "ExamQuestion"("paperId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ExamQuestion_chartImageId_idx" ON "ExamQuestion"("chartImageId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ExamQuestion_status_idx" ON "ExamQuestion"("status");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "ExamQuestion_paperId_chartImageId_key" ON "ExamQuestion"("paperId", "chartImageId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ExamAttempt_paperId_idx" ON "ExamAttempt"("paperId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ExamAttempt_status_idx" ON "ExamAttempt"("status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ExamAttempt_createdAt_idx" ON "ExamAttempt"("createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ExamAttemptAnswer_attemptId_idx" ON "ExamAttemptAnswer"("attemptId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ExamAttemptAnswer_questionId_idx" ON "ExamAttemptAnswer"("questionId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "ExamAttemptAnswer_attemptId_questionId_key" ON "ExamAttemptAnswer"("attemptId", "questionId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "ExamAttemptAnswer_attemptId_order_key" ON "ExamAttemptAnswer"("attemptId", "order");
