/**
 * VaultMigrator — applies Prisma migration SQL files to a SQLite database.
 *
 * Strategy: "raw SQL migrations" approach.
 * Rationale: `prisma migrate deploy` requires the Prisma CLI binary which is
 * not bundled in the Electron distribution. The `@prisma/migrate` programmatic
 * API is an internal package not suitable for direct use.
 * Instead we read the migration.sql files from the embedded migrations directory
 * and apply them ourselves, tracking applied migrations in the standard
 * `_prisma_migrations` table that Prisma itself uses. This ensures full
 * compatibility: if the user ever runs `prisma migrate deploy` manually, it
 * sees the same table and skips already-applied migrations.
 *
 * The migrations directory is resolved at runtime from the package source tree:
 * packages/db/prisma/migrations/
 */

import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { logger } from "../logger.js";

// ── Prisma migrations table (exact Prisma schema) ─────────────────────────

const CREATE_MIGRATIONS_TABLE = `
CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
  "id"                      TEXT PRIMARY KEY NOT NULL,
  "checksum"                TEXT NOT NULL,
  "finished_at"             DATETIME,
  "migration_name"          TEXT NOT NULL,
  "logs"                    TEXT,
  "rolled_back_at"          DATETIME,
  "started_at"              DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "applied_steps_count"     INTEGER NOT NULL DEFAULT 0
);
`;

interface MigrationRow {
  migration_name: string;
  finished_at: string | null;
}

interface MigrationFile {
  name: string;
  sqlPath: string;
}

/** Resolve the migrations directory, supporting dev (src tree) and production (asar). */
function resolveMigrationsDir(): string {
  // In the Electron app, __dirname resolves relative to the bundled output.
  // We look for migrations relative to the app root, falling back to the
  // monorepo source for dev.
  const candidates = [
    // Production: bundled alongside app resources
    path.join(process.resourcesPath ?? "", "prisma", "migrations"),
    // Dev / monorepo: __dirname is dist/main at runtime, 4 levels up reaches repo root
    // dist/main -> dist -> desktop -> apps -> amonote (repo root)
    path.resolve(__dirname, "..", "..", "..", "..", "packages", "db", "prisma", "migrations"),
    // Fallback: dev launched from apps/desktop (electron-vite dev mode cwd)
    path.resolve(process.cwd(), "..", "..", "packages", "db", "prisma", "migrations"),
    // Fallback: launched from repo root
    path.resolve(process.cwd(), "packages", "db", "prisma", "migrations"),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      logger.debug("VaultMigrator: using migrations dir", { dir: candidate });
      return candidate;
    }
  }

  throw new Error(
    `VaultMigrator: could not find migrations directory. Checked: ${candidates.join(", ")}`,
  );
}

/** List all migration folders sorted by name (chronological). */
function listMigrations(migrationsDir: string): MigrationFile[] {
  const entries = fs.readdirSync(migrationsDir, { withFileTypes: true });
  return entries
    .filter((e) => e.isDirectory())
    .map((e) => ({
      name: e.name,
      sqlPath: path.join(migrationsDir, e.name, "migration.sql"),
    }))
    .filter((m) => fs.existsSync(m.sqlPath))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Apply pending migrations to the given SQLite database. */
export function applyMigrations(dbPath: string): void {
  const db = new Database(dbPath);
  try {
    // Enable WAL mode for concurrency
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");

    // Ensure migrations table exists
    db.exec(CREATE_MIGRATIONS_TABLE);

    const migrationsDir = resolveMigrationsDir();
    const available = listMigrations(migrationsDir);

    // Fetch already-applied migrations
    const applied = new Set<string>(
      (db.prepare("SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL").all() as MigrationRow[])
        .map((r) => r.migration_name),
    );

    let count = 0;
    for (const migration of available) {
      if (applied.has(migration.name)) continue;

      const sql = fs.readFileSync(migration.sqlPath, "utf-8");
      const id = `${migration.name}-${Date.now()}`;
      const startedAt = new Date().toISOString();

      logger.info("VaultMigrator: applying migration", { name: migration.name });
      try {
        db.exec(sql);
        db.prepare(
          `INSERT INTO _prisma_migrations (id, checksum, migration_name, finished_at, applied_steps_count, started_at)
           VALUES (?, ?, ?, ?, 1, ?)`,
        ).run(id, "", migration.name, new Date().toISOString(), startedAt);
        count++;
      } catch (err) {
        logger.error("VaultMigrator: migration failed", { name: migration.name, err: String(err) });
        throw new Error(`Migration ${migration.name} failed: ${String(err)}`);
      }
    }

    logger.info("VaultMigrator: complete", { applied: count, total: available.length });
  } finally {
    db.close();
  }
}

/** Verify SQLite integrity. Returns true if OK. */
export function checkIntegrity(dbPath: string): boolean {
  const db = new Database(dbPath, { readonly: true });
  try {
    const result = db.prepare("PRAGMA integrity_check").get() as { integrity_check: string };
    return result.integrity_check === "ok";
  } catch {
    return false;
  } finally {
    db.close();
  }
}
