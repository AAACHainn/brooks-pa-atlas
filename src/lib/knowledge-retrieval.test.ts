import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import Database from "better-sqlite3";
import { load as loadSqliteVec } from "sqlite-vec";

import { vectorBuffer } from "@/lib/knowledge-db";
import { expandKnowledgeKeywords } from "@/lib/knowledge-keywords";
import { buildKnowledgeFtsQuery, resolveCurrentKnowledgeDocumentIds } from "@/lib/knowledge-search";

test("short price-action keywords include searchable aliases", () => {
  const aliases = expandKnowledgeKeywords(["H1", "H2", "MTR"]);
  const normalized = new Set(aliases.map((entry) => entry.normalizedKeyword));
  assert.ok(normalized.has("h1"));
  assert.ok(normalized.has("high 1"));
  assert.ok(normalized.has("二买"));
  assert.ok(normalized.has("major trend reversal"));
  assert.ok(normalized.has("主要趋势反转"));
});

test("Chinese FTS questions are split into searchable trigrams", () => {
  const query = buildKnowledgeFtsQuery("什么是强势突破回调？ H1 setup");
  assert.match(query, /"强势突"/);
  assert.match(query, /"突破回"/);
  assert.match(query, /"H1 setup"|"setup"/);
});

test("knowledge schema supports Chinese trigram FTS, short exact terms, and cosine ranking", async () => {
  const db = new Database(":memory:");
  loadSqliteVec(db);
  db.exec(await readFile(path.join(process.cwd(), "knowledge/migrations/20260930000000_init/migration.sql"), "utf8"));
  db.prepare("INSERT INTO KnowledgeDocument (id, title, lessonCode, normalizedLessonCode, indexPathSnapshot) VALUES ('d', '40A', '40A', '40a', '课程 / 40A')").run();
  db.prepare(`INSERT INTO KnowledgeDocumentVersion
    (id, documentId, versionNumber, sourceFileName, sourceMimeType, sourceSizeBytes, sourceHash, sourcePath, rawText, status)
    VALUES ('v', 'd', 1, '40A.srt', 'text/plain', 1, ?, 'source', 'raw', 'ACTIVE')`).run("a".repeat(64));
  db.prepare(`INSERT INTO KnowledgeChunk
    (id, versionId, ordinal, sourceCueStart, sourceCueEnd, originalText, cleanedText, topic, keywordsJson)
    VALUES ('c1', 'v', 0, 1, 1, '突破', '强势突破后出现回调', '突破', '["H1"]'),
           ('c2', 'v', 1, 2, 2, '区间', '交易区间中的失败突破', '区间', '["MTR"]')`).run();
  db.prepare("INSERT INTO KnowledgeChunkFts (chunkId, documentId, versionId, title, lessonCode, topic, keywords, cleanedText) VALUES ('c1','d','v','40A','40A','突破','H1','强势突破后出现回调'), ('c2','d','v','40A','40A','区间','MTR','交易区间中的失败突破')").run();
  db.prepare("INSERT INTO KnowledgeChunkKeyword (chunkId, keyword, normalizedKeyword) VALUES ('c1','H1','h1'), ('c2','MTR','mtr')").run();
  db.prepare("INSERT INTO KnowledgeEmbeddingProfile (id, endpointId, model, dimensions, status) VALUES ('p','e','m',3,'ACTIVE')").run();
  db.prepare("INSERT INTO KnowledgeChunkEmbedding (chunkId, profileId, embedding) VALUES ('c1','p',?), ('c2','p',?)")
    .run(vectorBuffer([1, 0, 0]), vectorBuffer([0, 1, 0]));

  const fts = db.prepare("SELECT chunkId FROM KnowledgeChunkFts WHERE KnowledgeChunkFts MATCH ? ORDER BY bm25(KnowledgeChunkFts)")
    .all('"强势突破"') as Array<{ chunkId: string }>;
  assert.equal(fts[0].chunkId, "c1");
  const exact = db.prepare("SELECT chunkId FROM KnowledgeChunkKeyword WHERE normalizedKeyword = 'h1'").get() as { chunkId: string };
  assert.equal(exact.chunkId, "c1");
  const vector = db.prepare("SELECT chunkId FROM KnowledgeChunkEmbedding ORDER BY vec_distance_cosine(embedding, ?) LIMIT 1")
    .get(vectorBuffer([0.9, 0.1, 0])) as { chunkId: string };
  assert.equal(vector.chunkId, "c1");
  db.close();
});

test("only one active document version and one active embedding profile are allowed", async () => {
  const db = new Database(":memory:");
  loadSqliteVec(db);
  db.exec(await readFile(path.join(process.cwd(), "knowledge/migrations/20260930000000_init/migration.sql"), "utf8"));
  db.prepare("INSERT INTO KnowledgeDocument (id, title, indexPathSnapshot) VALUES ('d', 'doc', 'path')").run();
  const insert = db.prepare(`INSERT INTO KnowledgeDocumentVersion
    (id, documentId, versionNumber, sourceFileName, sourceMimeType, sourceSizeBytes, sourceHash, sourcePath, rawText, status)
    VALUES (?, 'd', ?, 'x.srt', 'text/plain', 1, ?, 'x', 'x', 'ACTIVE')`);
  insert.run("v1", 1, "a".repeat(64));
  assert.throws(() => insert.run("v2", 2, "b".repeat(64)), /unique/i);
  db.close();
});

test("current retrieval scope accumulates all inheritable ancestors without stopping at the nearest binding", () => {
  const nodes = [
    { id: "root", parentId: null },
    { id: "course", parentId: "root" },
    { id: "lesson", parentId: "course" },
  ];
  const bindings = [
    { documentId: "book", indexNodeId: "root", appliesToDescendants: true },
    { documentId: "course-note", indexNodeId: "course", appliesToDescendants: false },
    { documentId: "subtitle", indexNodeId: "lesson", appliesToDescendants: false },
  ];
  assert.deepEqual(resolveCurrentKnowledgeDocumentIds("lesson", nodes, bindings), ["book", "subtitle"]);
  assert.deepEqual(resolveCurrentKnowledgeDocumentIds("course", nodes, bindings), ["book", "course-note"]);
});
