-- CreateTable
CREATE TABLE "ImageAnnotation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "chartImageId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "x" REAL NOT NULL,
    "y" REAL NOT NULL,
    "width" REAL NOT NULL DEFAULT 0.24,
    "fontSize" INTEGER NOT NULL DEFAULT 18,
    "color" TEXT NOT NULL DEFAULT '#111827',
    "backgroundColor" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ImageAnnotation_chartImageId_fkey" FOREIGN KEY ("chartImageId") REFERENCES "ChartImage" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "ImageAnnotation_chartImageId_idx" ON "ImageAnnotation"("chartImageId");
