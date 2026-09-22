import assert from "node:assert/strict";
import test from "node:test";

import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

import { PrismaClient } from "../generated/prisma/client";
import { findLiteralSearchImageIds } from "./image-search";

test("image search treats LIKE wildcard characters as literal text", async () => {
  const client = new PrismaClient({
    adapter: new PrismaBetterSqlite3({ url: "file::memory:" }),
  });

  try {
    await client.$executeRawUnsafe(`
      CREATE TABLE "ChartImage" (
        "id" TEXT PRIMARY KEY,
        "originalName" TEXT NOT NULL,
        "title" TEXT,
        "notes" TEXT,
        "ocrText" TEXT,
        "indexNodeId" TEXT
      )
    `);
    await client.$executeRawUnsafe(`CREATE TABLE "IndexNode" ("id" TEXT PRIMARY KEY, "path" TEXT NOT NULL)`);
    await client.$executeRawUnsafe(`CREATE TABLE "Tag" ("id" TEXT PRIMARY KEY, "name" TEXT NOT NULL)`);
    await client.$executeRawUnsafe(`CREATE TABLE "ChartImageTag" ("chartImageId" TEXT, "tagId" TEXT)`);
    await client.$executeRawUnsafe(`CREATE TABLE "ImageAnnotation" ("chartImageId" TEXT, "text" TEXT NOT NULL)`);

    await client.$executeRawUnsafe(
      `INSERT INTO "ChartImage" ("id", "originalName", "title", "notes", "ocrText", "indexNodeId") VALUES (?, ?, ?, ?, ?, ?)`,
      "literal-percent",
      "profit-60%.png",
      null,
      null,
      null,
      null,
    );
    await client.$executeRawUnsafe(
      `INSERT INTO "ChartImage" ("id", "originalName", "title", "notes", "ocrText", "indexNodeId") VALUES (?, ?, ?, ?, ?, ?)`,
      "plain-number",
      "plain.png",
      null,
      null,
      "60 min EMA",
      null,
    );
    await client.$executeRawUnsafe(
      `INSERT INTO "ChartImage" ("id", "originalName", "title", "notes", "ocrText", "indexNodeId") VALUES (?, ?, ?, ?, ?, ?)`,
      "literal-underscore",
      "underscore.png",
      "A_B",
      null,
      null,
      null,
    );
    await client.$executeRawUnsafe(
      `INSERT INTO "ChartImage" ("id", "originalName", "title", "notes", "ocrText", "indexNodeId") VALUES (?, ?, ?, ?, ?, ?)`,
      "underscore-lookalike",
      "lookalike.png",
      "ACB",
      null,
      null,
      null,
    );
    await client.$executeRawUnsafe(
      `INSERT INTO "ChartImage" ("id", "originalName", "title", "notes", "ocrText", "indexNodeId") VALUES (?, ?, ?, ?, ?, ?)`,
      "literal-backslash",
      String.raw`folder\chart.png`,
      null,
      null,
      null,
      null,
    );
    await client.$executeRawUnsafe(
      `INSERT INTO "IndexNode" ("id", "path") VALUES (?, ?)`,
      "index-with-percent",
      "Root / 70% Pullback",
    );
    await client.$executeRawUnsafe(
      `INSERT INTO "ChartImage" ("id", "originalName", "title", "notes", "ocrText", "indexNodeId") VALUES (?, ?, ?, ?, ?, ?)`,
      "index-match",
      "index.png",
      null,
      null,
      null,
      "index-with-percent",
    );
    await client.$executeRawUnsafe(`INSERT INTO "Tag" ("id", "name") VALUES (?, ?)`, "special-tag", "tag_100");
    await client.$executeRawUnsafe(
      `INSERT INTO "ChartImage" ("id", "originalName", "title", "notes", "ocrText", "indexNodeId") VALUES (?, ?, ?, ?, ?, ?)`,
      "tag-match",
      "tag.png",
      null,
      null,
      null,
      null,
    );
    await client.$executeRawUnsafe(
      `INSERT INTO "ChartImageTag" ("chartImageId", "tagId") VALUES (?, ?)`,
      "tag-match",
      "special-tag",
    );
    await client.$executeRawUnsafe(
      `INSERT INTO "ChartImage" ("id", "originalName", "title", "notes", "ocrText", "indexNodeId") VALUES (?, ?, ?, ?, ?, ?)`,
      "annotation-match",
      "annotation.png",
      null,
      null,
      null,
      null,
    );
    await client.$executeRawUnsafe(
      `INSERT INTO "ImageAnnotation" ("chartImageId", "text") VALUES (?, ?)`,
      "annotation-match",
      String.raw`risk\reward`,
    );

    assert.deepEqual([...await findLiteralSearchImageIds("60%", client)], ["literal-percent"]);
    assert.deepEqual(
      [...await findLiteralSearchImageIds("60", client)].sort(),
      ["literal-percent", "plain-number"],
    );
    assert.deepEqual(
      [...await findLiteralSearchImageIds("_", client)].sort(),
      ["literal-underscore", "tag-match"],
    );
    assert.deepEqual(
      [...await findLiteralSearchImageIds("\\", client)].sort(),
      ["annotation-match", "literal-backslash"],
    );
    assert.deepEqual([...await findLiteralSearchImageIds("70%", client)], ["index-match"]);
  } finally {
    await client.$disconnect();
  }
});
