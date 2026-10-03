import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import Database from "better-sqlite3";
import { load as loadSqliteVec } from "sqlite-vec";
import { countKnowledgeScope, listDeepKnowledgeDocuments, readKnowledgeScope, retrieveDeepKnowledgeCandidates } from "@/lib/knowledge-deep-search";

async function fixture() {
  const db = new Database(":memory:");
  loadSqliteVec(db);
  for (const name of ["20260930000000_init", "20261002000000_generalize_knowledge_sources"]) {
    db.exec(await readFile(path.join(process.cwd(), "knowledge/migrations", name, "migration.sql"), "utf8"));
  }
  for (const [id, type, enabled, status, hash] of [
    ["book", "BOOK", 1, "ACTIVE", "a"], ["19A", "SUBTITLE", 1, "ACTIVE", "b"],
    ["disabled", "BOOK", 0, "ACTIVE", "c"], ["orphan", "BOOK", 1, "ORPHANED", "d"],
  ] as const) {
    db.prepare("INSERT INTO KnowledgeDocument(id,title,lessonCode,sourceType,enabled) VALUES (?,?,?,?,?)").run(id, id, id, type, enabled);
    db.prepare(`INSERT INTO KnowledgeDocumentVersion(id,documentId,versionNumber,sourceFileName,sourceMimeType,sourceSizeBytes,sourceHash,sourcePath,rawText,status,sourceFormat)
      VALUES (?,?,1,?,'text/plain',1,?,'source','raw','ACTIVE',?)`).run(`v-${id}`, id, `${id}.txt`, hash.repeat(64), type === "BOOK" ? "MARKDOWN" : "SRT");
    db.prepare("INSERT INTO KnowledgeDocumentBinding(id,documentId,indexNodeId,indexPathSnapshot,status) VALUES (?,?,?,?,?)").run(`bind-${id}`, id, `node-${id}`, id, status);
    for (let i = 0; i < (id === "book" ? 130 : 3); i++) {
      const text = `突破与支撑 ${id} 第${i}段`;
      const locator = type === "BOOK"
        ? { v: 1, kind: "text", lineStart: i * 5 + 1, lineEnd: i * 5 + 5, headingPath: [i < 125 ? "第一章" : "第二章"] }
        : { v: 1, kind: "subtitle", cueStart: i + 1, cueEnd: i + 1, startMs: i * 1_000, endMs: i * 1_000 + 999 };
      db.prepare(`INSERT INTO KnowledgeChunk(id,versionId,ordinal,sourceCueStart,sourceCueEnd,originalText,cleanedText,topic,keywordsJson,locatorJson)
        VALUES (?,?,?,?,?,?,?,'突破','["支撑"]',?)`).run(`${id}-${i}`, `v-${id}`, i, i + 1, i + 1, text, text, JSON.stringify(locator));
      db.prepare("INSERT INTO KnowledgeChunkFts(chunkId,documentId,versionId,title,lessonCode,topic,keywords,cleanedText) VALUES (?,?,?,?,?,'突破','支撑',?)")
        .run(`${id}-${i}`, id, `v-${id}`, id, id, text);
      db.prepare("INSERT INTO KnowledgeChunkKeyword(chunkId,keyword,normalizedKeyword) VALUES (?,'支撑','支撑')").run(`${id}-${i}`);
    }
  }
  return db;
}

test("deep catalogs and paged chapter reads exclude inactive sources and other chapters", async () => {
  const db = await fixture();
  try {
    const catalog = listDeepKnowledgeDocuments(db);
    assert.deepEqual(catalog.map((doc) => doc.id).sort(), ["19A", "book"]);
    assert.deepEqual(catalog.find((doc) => doc.id === "book")?.headings.sort(), [["第一章"], ["第二章"]].sort());
    const target = [{ documentId: "book", headingPath: ["第一章"] }];
    assert.equal(countKnowledgeScope(target, db)[0].availableChunks, 125);
    const chunks = [];
    for await (const chunk of readKnowledgeScope(target, ["book"], new AbortController().signal, db)) chunks.push(chunk);
    assert.equal(chunks.length, 125);
    assert.equal(chunks[0].id, "book-0");
    assert.equal(chunks.at(-1)?.id, "book-124");
    assert.equal(chunks[0].versionId, "v-book");
    assert.equal(chunks[0].locator.kind, "text");
  } finally { db.close(); }
});

test("deep recall combines subtitle and book candidates and degrades without vectors", async () => {
  const db = await fixture();
  try {
    const result = await retrieveDeepKnowledgeCandidates({ db, queries: ["突破与支撑", "支撑"], currentIds: ["19A"],
      targets: [{ documentId: "book", headingPath: [] }, { documentId: "19A", headingPath: [] }], signal: new AbortController().signal });
    assert.equal(result.semanticSearchUsed, false);
    assert.ok(result.candidates.some((source) => source.documentId === "19A"));
    assert.ok(result.candidates.some((source) => source.documentId === "book"));
    assert.ok(result.candidates.every((source) => !["disabled", "orphan"].includes(source.documentId)));
    assert.ok(result.candidates.every((source) => source.queryIndexes.includes(0)));
    assert.ok(result.candidates.length > 8);
    for (const queryIndex of [0, 1]) assert.ok(result.candidates.filter((candidate) => candidate.queryIndexes.includes(queryIndex)).length <= 100);
  } finally { db.close(); }
});

test("paged scope reading observes cancellation", async () => {
  const db = await fixture();
  try {
    const controller = new AbortController();
    const iterator = readKnowledgeScope([{ documentId: "book", headingPath: [] }], [], controller.signal, db);
    await iterator.next();
    controller.abort();
    await assert.rejects(iterator.next(), { name: "AbortError" });
  } finally { db.close(); }
});
