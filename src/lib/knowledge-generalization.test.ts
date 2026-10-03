import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import Database from "better-sqlite3";

import { assertKnowledgeImportLimits, assertKnowledgeImportMode } from "@/lib/knowledge-import-jobs";

async function sql(name: string) {
  return readFile(path.join(process.cwd(), "knowledge", "migrations", name, "migration.sql"), "utf8");
}

test("generalization migration preserves document graph and converts legacy binding state", async () => {
  const db = new Database(":memory:");
  db.exec(await sql("20260930000000_init"));
  db.prepare(`INSERT INTO KnowledgeDocument
    (id, title, indexNodeId, indexPathSnapshot, bindingStatus) VALUES
    ('active', 'Active', 'n1', 'Root / Active', 'ACTIVE'),
    ('disabled', 'Disabled', 'n2', 'Root / Disabled', 'DISABLED'),
    ('orphaned', 'Orphaned', NULL, 'Root / Missing', 'ORPHANED')`).run();
  db.prepare(`INSERT INTO KnowledgeDocumentVersion
    (id, documentId, versionNumber, sourceFileName, sourceMimeType, sourceSizeBytes, sourceHash, sourcePath, rawText, status)
    VALUES ('v1','active',1,'legacy.txt','text/plain',1,?,'source','raw','ACTIVE')`).run("a".repeat(64));
  db.prepare(`INSERT INTO KnowledgeChunk
    (id, versionId, ordinal, sourceCueStart, sourceCueEnd, startMs, endMs, originalText, cleanedText)
    VALUES ('c1','v1',0,2,4,1000,3000,'raw','clean')`).run();
  db.prepare("INSERT INTO KnowledgeChunkKeyword (chunkId, keyword, normalizedKeyword) VALUES ('c1','H1','h1')").run();
  db.prepare("INSERT INTO KnowledgeChunkFts (chunkId, documentId, versionId, title, lessonCode, topic, keywords, cleanedText) VALUES ('c1','active','v1','Active','','','H1','clean')").run();
  db.prepare("INSERT INTO KnowledgeEmbeddingProfile (id, endpointId, model, dimensions, status) VALUES ('p1','e','m',1,'ACTIVE')").run();
  db.prepare("INSERT INTO KnowledgeChunkEmbedding (chunkId, profileId, embedding) VALUES ('c1','p1',?)").run(Buffer.alloc(4));

  db.exec(await sql("20261002000000_generalize_knowledge_sources"));

  assert.deepEqual(db.prepare("SELECT id, sourceType, enabled FROM KnowledgeDocument ORDER BY id").all(), [
    { id: "active", sourceType: "SUBTITLE", enabled: 1 },
    { id: "disabled", sourceType: "SUBTITLE", enabled: 0 },
    { id: "orphaned", sourceType: "SUBTITLE", enabled: 1 },
  ]);
  assert.equal((db.prepare("SELECT sourceFormat FROM KnowledgeDocumentVersion WHERE id = 'v1'").get() as { sourceFormat: string }).sourceFormat, "TXT");
  assert.deepEqual(db.prepare("SELECT documentId, indexNodeId, status FROM KnowledgeDocumentBinding ORDER BY documentId").all(), [
    { documentId: "active", indexNodeId: "n1", status: "ACTIVE" },
    { documentId: "disabled", indexNodeId: "n2", status: "ACTIVE" },
    { documentId: "orphaned", indexNodeId: null, status: "ORPHANED" },
  ]);
  assert.equal((db.prepare("SELECT json_extract(locatorJson, '$.cueStart') AS cueStart FROM KnowledgeChunk WHERE id = 'c1'").get() as { cueStart: number }).cueStart, 2);
  assert.equal((db.prepare("SELECT COUNT(*) AS count FROM KnowledgeChunkKeyword").get() as { count: number }).count, 1);
  assert.deepEqual(db.prepare("SELECT chunkId, profileId FROM KnowledgeChunkEmbedding").all(), [{ chunkId: "c1", profileId: "p1" }]);
  assert.deepEqual(db.prepare("SELECT chunkId, versionId FROM KnowledgeChunkFts").all(), [{ chunkId: "c1", versionId: "v1" }]);
  assert.throws(() => db.prepare("INSERT INTO KnowledgeDocumentBinding (id, documentId, indexNodeId, indexPathSnapshot) VALUES ('b4','active','n4','n4')").run(), /unique/i);
  db.prepare("INSERT INTO KnowledgeDocument (id, title) VALUES ('other','Other')").run();
  assert.throws(() => db.prepare("INSERT INTO KnowledgeDocumentBinding (id, documentId, indexNodeId, indexPathSnapshot) VALUES ('b5','other','n1','n1')").run(), /unique/i);
  db.close();
});

test("import formats enforce source types and mixed batches cannot use AI processing", () => {
  const source = (fileName: string, sourceType: "SUBTITLE" | "BOOK") => ({
    fileName, sourceType, mimeType: "text/plain", buffer: Buffer.from("text"),
    targetIndexNodeId: "n", targetIndexPath: "Root / n",
  });
  assert.doesNotThrow(() => assertKnowledgeImportLimits([source("book.txt", "BOOK")]));
  assert.throws(() => assertKnowledgeImportLimits([source("lesson.srt", "BOOK")]), /必须作为字幕/);
  assert.throws(() => assertKnowledgeImportLimits([source("book.md", "SUBTITLE")]), /不能作为字幕/);
  assert.throws(() => assertKnowledgeImportMode([source("lesson.srt", "SUBTITLE"), source("book.md", "BOOK")], "AI"), /只适用于/);
  assert.doesNotThrow(() => assertKnowledgeImportMode([source("lesson.srt", "SUBTITLE")], "AI"));
});
