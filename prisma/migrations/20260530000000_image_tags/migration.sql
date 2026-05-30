-- CreateTable
CREATE TABLE "Tag" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "ChartImageTag" (
    "chartImageId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("chartImageId", "tagId"),
    CONSTRAINT "ChartImageTag_chartImageId_fkey" FOREIGN KEY ("chartImageId") REFERENCES "ChartImage" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ChartImageTag_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "Tag" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Tag_normalizedName_key" ON "Tag"("normalizedName");

-- CreateIndex
CREATE INDEX "Tag_name_idx" ON "Tag"("name");

-- CreateIndex
CREATE INDEX "ChartImageTag_tagId_idx" ON "ChartImageTag"("tagId");
