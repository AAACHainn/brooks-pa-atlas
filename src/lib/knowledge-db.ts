import { mkdirSync } from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";
import { load as loadSqliteVec } from "sqlite-vec";

type KnowledgeDatabase = InstanceType<typeof Database>;

const globalForKnowledge = globalThis as typeof globalThis & {
  brooksKnowledgeDb?: KnowledgeDatabase;
};

function filePathFromUrl(value: string) {
  return value.replace(/^file:/, "");
}

export function getKnowledgeDatabasePath() {
  return filePathFromUrl(
    process.env.BROOKS_KNOWLEDGE_DATABASE_URL ?? "file:./knowledge.db",
  );
}

export function getKnowledgeRoot() {
  const configured = process.env.BROOKS_KNOWLEDGE_ROOT;
  return configured
    ? path.resolve(/* turbopackIgnore: true */ configured)
    : path.join(/* turbopackIgnore: true */ process.cwd(), "data", "library", "knowledge");
}

export function getKnowledgeSourceRoot() {
  return path.join(getKnowledgeRoot(), "sources");
}

function openKnowledgeDatabase() {
  const dbPath = path.resolve(getKnowledgeDatabasePath());
  mkdirSync(path.dirname(dbPath), { recursive: true });
  mkdirSync(getKnowledgeSourceRoot(), { recursive: true });
  const db = new Database(dbPath);
  db.pragma("foreign_keys = ON");
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.pragma("busy_timeout = 5000");
  db.pragma("cache_size = -16384");
  loadSqliteVec(db);
  const ready = db.prepare(
    "SELECT 1 AS ready FROM sqlite_master WHERE type = 'table' AND name = 'KnowledgeDocument'",
  ).get();
  if (!ready) {
    db.close();
    throw new Error("Knowledge database is not initialized. Run npm run db:migrate.");
  }
  return db;
}

export function knowledgeDb() {
  globalForKnowledge.brooksKnowledgeDb ??= openKnowledgeDatabase();
  return globalForKnowledge.brooksKnowledgeDb;
}

export function closeKnowledgeDatabaseForTests() {
  globalForKnowledge.brooksKnowledgeDb?.close();
  delete globalForKnowledge.brooksKnowledgeDb;
}

export function vectorBuffer(values: number[]) {
  return Buffer.from(Float32Array.from(values).buffer);
}
