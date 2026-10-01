import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import Database from "better-sqlite3";

import {
  collectKnowledgeBackup,
  finalizeKnowledgeRestore,
  prepareKnowledgeRestore,
  restoreKnowledgeEntry,
} from "@/lib/knowledge-backup";
import { closeKnowledgeDatabaseForTests, knowledgeDb, vectorBuffer } from "@/lib/knowledge-db";

async function initializeKnowledgeDatabase(databasePath: string) {
  const db = new Database(databasePath);
  for (const migration of ["20260930000000_init", "20260930020000_maintenance_jobs"]) {
    db.exec(await readFile(path.join(process.cwd(), "knowledge", "migrations", migration, "migration.sql"), "utf8"));
  }
  db.close();
}

test("knowledge backup restores source, chunks, keywords, vectors, active profile, and FTS", async () => {
  const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), "brooks-knowledge-backup-"));
  const sourceRoot = path.join(fixtureRoot, "source-library");
  const sourceDirectory = path.join(sourceRoot, "sources");
  const firstDatabase = path.join(fixtureRoot, "first.db");
  await mkdir(sourceDirectory, { recursive: true });
  await initializeKnowledgeDatabase(firstDatabase);
  process.env.BROOKS_KNOWLEDGE_DATABASE_URL = `file:${firstDatabase}`;
  process.env.BROOKS_KNOWLEDGE_ROOT = sourceRoot;

  const sourceBuffer = Buffer.from("1\n00:00:01,000 --> 00:00:03,000\n强势突破 H1\n");
  const sourceHash = createHash("sha256").update(sourceBuffer).digest("hex");
  const sourcePath = path.join(sourceDirectory, `${sourceHash}.srt`);
  await writeFile(sourcePath, sourceBuffer);
  const db = knowledgeDb();
  db.prepare("INSERT INTO KnowledgeEmbeddingProfile (id, endpointId, model, dimensions, status) VALUES ('p1','e1','embed',3,'ACTIVE')").run();
  db.prepare("INSERT INTO KnowledgeDocument (id, title, lessonCode, normalizedLessonCode, indexNodeId, indexPathSnapshot) VALUES ('d1','40A','40A','40a','old-node','课程 / 40A')").run();
  db.prepare(`INSERT INTO KnowledgeDocumentVersion
    (id, documentId, versionNumber, sourceFileName, sourceMimeType, sourceSizeBytes, sourceHash, sourcePath, rawText, status)
    VALUES ('v1','d1',1,'40A.srt','application/x-subrip',?,?,?,'强势突破 H1','ACTIVE')`)
    .run(sourceBuffer.length, sourceHash, sourcePath);
  db.prepare(`INSERT INTO KnowledgeChunk
    (id, versionId, ordinal, sourceCueStart, sourceCueEnd, startMs, endMs, originalText, cleanedText, topic, keywordsJson)
    VALUES ('c1','v1',0,1,1,1000,3000,'强势突破 H1','强势突破后的 H1 回调','突破','["H1"]')`).run();
  db.prepare("INSERT INTO KnowledgeChunkKeyword (chunkId, keyword, normalizedKeyword) VALUES ('c1','H1','h1')").run();
  const embeddingBuffer = vectorBuffer([1, 0, 0]);
  db.prepare("INSERT INTO KnowledgeChunkEmbedding (chunkId, profileId, embedding) VALUES ('c1','p1',?)").run(embeddingBuffer);
  db.prepare("INSERT INTO KnowledgeChunkFts (chunkId, documentId, versionId, title, lessonCode, topic, keywords, cleanedText) VALUES ('c1','d1','v1','40A','40A','突破','H1','强势突破后的 H1 回调')").run();

  const collected = await collectKnowledgeBackup({ allowedOriginalPaths: null, exportPathByOriginalPath: new Map() });
  assert.equal(collected.knowledge.documents.length, 1);
  assert.equal(collected.knowledge.profiles.length, 1);
  const version = collected.knowledge.documents[0].versions[0];
  const embeddingPath = version.chunks[0].embeddings[0].path;
  closeKnowledgeDatabaseForTests();

  const restoredRoot = path.join(fixtureRoot, "restored-library");
  const restoredDatabase = path.join(fixtureRoot, "restored.db");
  await initializeKnowledgeDatabase(restoredDatabase);
  process.env.BROOKS_KNOWLEDGE_DATABASE_URL = `file:${restoredDatabase}`;
  process.env.BROOKS_KNOWLEDGE_ROOT = restoredRoot;
  const state = await prepareKnowledgeRestore(collected.knowledge, new Map([["课程 / 40A", "new-node"]]));
  await restoreKnowledgeEntry(state, version.sourcePath, sourceBuffer);
  await restoreKnowledgeEntry(state, embeddingPath, embeddingBuffer);
  finalizeKnowledgeRestore(state);

  const restored = knowledgeDb();
  assert.equal((restored.prepare("SELECT indexNodeId FROM KnowledgeDocument").get() as { indexNodeId: string }).indexNodeId, "new-node");
  assert.equal((restored.prepare("SELECT COUNT(*) AS count FROM KnowledgeChunk").get() as { count: number }).count, 1);
  assert.equal((restored.prepare("SELECT status FROM KnowledgeEmbeddingProfile").get() as { status: string }).status, "ACTIVE");
  assert.deepEqual((restored.prepare("SELECT embedding FROM KnowledgeChunkEmbedding").get() as { embedding: Buffer }).embedding, embeddingBuffer);
  assert.equal((restored.prepare("SELECT COUNT(*) AS count FROM KnowledgeChunkKeyword WHERE normalizedKeyword = 'high 1'").get() as { count: number }).count, 1);
  assert.equal((restored.prepare("SELECT chunkId FROM KnowledgeChunkFts WHERE KnowledgeChunkFts MATCH ?").get('"强势突破"') as { chunkId: string }).chunkId.length > 0, true);
  assert.equal(state.restoredDocuments, 1);
  closeKnowledgeDatabaseForTests();
  delete process.env.BROOKS_KNOWLEDGE_DATABASE_URL;
  delete process.env.BROOKS_KNOWLEDGE_ROOT;
});
