DROP INDEX IF EXISTS "IndexNodeNavigatorOption_optionId_idx";
CREATE INDEX "IndexNodeNavigatorOption_optionId_indexNodeId_idx"
ON "IndexNodeNavigatorOption"("optionId", "indexNodeId");
