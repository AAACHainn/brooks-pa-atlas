import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import Database from "better-sqlite3";

import { closeKnowledgeDatabaseForTests, knowledgeDb } from "@/lib/knowledge-db";
import { storeChunkEmbeddings } from "@/lib/knowledge-embeddings";

test("embedding writes validate stable profile and chunk parents before storing vectors", async () => {
  const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), "brooks-knowledge-embeddings-"));
  const databasePath = path.join(fixtureRoot, "knowledge.db");
  const setup = new Database(databasePath);
  setup.exec(await readFile(
    path.join(process.cwd(), "knowledge/migrations/20260930000000_init/migration.sql"),
    "utf8",
  ));
  setup.close();
  process.env.BROOKS_KNOWLEDGE_DATABASE_URL = `file:${databasePath}`;
  process.env.BROOKS_KNOWLEDGE_ROOT = path.join(fixtureRoot, "library");

  try {
    const db = knowledgeDb();
    db.prepare("INSERT INTO KnowledgeEmbeddingProfile (id, endpointId, model, dimensions, status) VALUES ('p','e','m',3,'ACTIVE')").run();
    db.prepare("INSERT INTO KnowledgeDocument (id, title, indexPathSnapshot) VALUES ('d','doc','course / doc')").run();
    db.prepare(`INSERT INTO KnowledgeDocumentVersion
      (id, documentId, versionNumber, sourceFileName, sourceMimeType, sourceSizeBytes, sourceHash, sourcePath, rawText, status)
      VALUES ('v','d',1,'doc.srt','text/plain',1,?,'source','raw','PROCESSING')`).run("a".repeat(64));
    db.prepare(`INSERT INTO KnowledgeChunk
      (id, versionId, ordinal, sourceCueStart, sourceCueEnd, originalText, cleanedText)
      VALUES ('c','v',0,1,1,'raw','clean')`).run();

    storeChunkEmbeddings([{ chunkId: "c", vector: [1, 0, 0] }], "p");
    assert.equal((db.prepare("SELECT COUNT(*) AS count FROM KnowledgeChunkEmbedding").get() as { count: number }).count, 1);
    assert.throws(
      () => storeChunkEmbeddings([{ chunkId: "missing", vector: [1, 0, 0] }], "p"),
      /chunks changed/i,
    );
    assert.deepEqual(db.pragma("foreign_key_check"), []);
  } finally {
    closeKnowledgeDatabaseForTests();
    delete process.env.BROOKS_KNOWLEDGE_DATABASE_URL;
    delete process.env.BROOKS_KNOWLEDGE_ROOT;
  }
});
