import { existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";

function databasePathFromUrl(value) {
  return value.replace(/^file:/, "");
}

export function migrateKnowledgeDatabase() {
  const dbUrl = process.env.BROOKS_KNOWLEDGE_DATABASE_URL ?? "file:./knowledge.db";
  const dbPath = databasePathFromUrl(dbUrl);
  const parent = path.dirname(path.resolve(dbPath));
  mkdirSync(parent, { recursive: true });

  const migrationsRoot = path.join(process.cwd(), "knowledge", "migrations");
  const migrationTable = "_brooks_knowledge_migrations";
  const db = new Database(dbPath);
  db.pragma("foreign_keys = ON");
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.pragma("busy_timeout = 5000");
  db.exec(`
    CREATE TABLE IF NOT EXISTS "${migrationTable}" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "appliedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  const applied = new Set(
    db.prepare(`SELECT "id" FROM "${migrationTable}"`).all().map((row) => row.id),
  );
  const migrations = existsSync(migrationsRoot)
    ? readdirSync(migrationsRoot, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort()
    : [];

  let appliedCount = 0;
  for (const migrationId of migrations) {
    if (applied.has(migrationId)) continue;
    const migrationPath = path.join(migrationsRoot, migrationId, "migration.sql");
    if (!existsSync(migrationPath)) continue;
    const sql = readFileSync(migrationPath, "utf8");
    db.transaction(() => {
      db.exec(sql);
      db.prepare(`INSERT INTO "${migrationTable}" ("id") VALUES (?)`).run(migrationId);
    })();
    appliedCount += 1;
    console.log(`Applied knowledge migration ${migrationId}`);
  }

  if (appliedCount === 0) {
    console.log(`Knowledge SQLite schema is up to date at ${dbPath}`);
  } else {
    console.log(`Applied ${appliedCount} knowledge migration(s) to ${dbPath}`);
  }
  db.close();
}
