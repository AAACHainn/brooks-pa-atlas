UPDATE "KnowledgeImportItem"
SET "error" = NULL,
    "errorPhase" = NULL
WHERE "status" IN ('COMPLETED', 'AWAITING_REVIEW', 'REJECTED');
