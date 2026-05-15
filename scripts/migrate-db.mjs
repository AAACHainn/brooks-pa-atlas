import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";

const dbUrl = process.env.DATABASE_URL ?? "file:./dev.db";
const dbPath = dbUrl.replace(/^file:/, "");
const migrationsRoot = path.join(process.cwd(), "prisma", "migrations");
const migrationTable = "_brooks_migrations";
const initialMigration = "20260505000000_init";

function tableExists(db, name) {
  return Boolean(
    db
      .prepare("select name from sqlite_master where type = ? and name = ?")
      .get("table", name),
  );
}

const db = new Database(dbPath);
db.pragma("foreign_keys = ON");
db.exec(`
CREATE TABLE IF NOT EXISTS "${migrationTable}" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "appliedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
`);

if (tableExists(db, "IndexNode")) {
  db
    .prepare(`INSERT OR IGNORE INTO "${migrationTable}" ("id") VALUES (?)`)
    .run(initialMigration);
}

const applied = new Set(
  db
    .prepare(`SELECT "id" FROM "${migrationTable}"`)
    .all()
    .map((row) => row.id),
);

const migrations = readdirSync(migrationsRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

let appliedCount = 0;

for (const migrationId of migrations) {
  if (applied.has(migrationId)) {
    continue;
  }

  const migrationPath = path.join(migrationsRoot, migrationId, "migration.sql");
  if (!existsSync(migrationPath)) {
    continue;
  }

  const sql = readFileSync(migrationPath, "utf8");
  const apply = db.transaction(() => {
    db.exec(sql);
    db
      .prepare(`INSERT INTO "${migrationTable}" ("id") VALUES (?)`)
      .run(migrationId);
  });
  apply();
  appliedCount += 1;
  console.log(`Applied migration ${migrationId}`);
}

if (appliedCount === 0) {
  console.log(`SQLite schema is up to date at ${dbPath}`);
} else {
  console.log(`Applied ${appliedCount} migration(s) to ${dbPath}`);
}

db.close();
