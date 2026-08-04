CREATE TABLE "IndexNavigatorCategory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE TABLE "IndexNavigatorOption" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "categoryId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "IndexNavigatorOption_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "IndexNavigatorCategory" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "IndexNodeNavigatorOption" (
    "indexNodeId" TEXT NOT NULL,
    "optionId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY ("indexNodeId", "optionId"),
    CONSTRAINT "IndexNodeNavigatorOption_indexNodeId_fkey" FOREIGN KEY ("indexNodeId") REFERENCES "IndexNode" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "IndexNodeNavigatorOption_optionId_fkey" FOREIGN KEY ("optionId") REFERENCES "IndexNavigatorOption" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "IndexNavigatorCategory_normalizedName_key" ON "IndexNavigatorCategory"("normalizedName");
CREATE INDEX "IndexNavigatorCategory_sortOrder_idx" ON "IndexNavigatorCategory"("sortOrder");
CREATE UNIQUE INDEX "IndexNavigatorOption_categoryId_normalizedName_key" ON "IndexNavigatorOption"("categoryId", "normalizedName");
CREATE INDEX "IndexNavigatorOption_categoryId_sortOrder_idx" ON "IndexNavigatorOption"("categoryId", "sortOrder");
CREATE INDEX "IndexNodeNavigatorOption_optionId_idx" ON "IndexNodeNavigatorOption"("optionId");
