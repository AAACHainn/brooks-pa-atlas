import { readFileSync } from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";

const dbUrl = process.env.DATABASE_URL ?? "file:./dev.db";
const dbPath = dbUrl.replace(/^file:/, "");
const migrationPath = path.join(
  process.cwd(),
  "prisma",
  "migrations",
  "20260505000000_init",
  "migration.sql",
);

const db = new Database(dbPath);
const existingTables = db
  .prepare("select name from sqlite_master where type = ? and name not like ?")
  .all("table", "sqlite_%");

if (existingTables.length === 0) {
  db.exec(readFileSync(migrationPath, "utf8"));
  console.log(`Initialized SQLite schema at ${dbPath}`);
} else {
  console.log(`SQLite schema already exists at ${dbPath}`);
}

db.close();

await import("./migrate-db.mjs");
