-- AddQuestionType
ALTER TABLE "ExamQuestion" ADD COLUMN "questionType" TEXT NOT NULL DEFAULT 'SINGLE';

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ExamQuestion_questionType_idx" ON "ExamQuestion"("questionType");
