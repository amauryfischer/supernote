/**
 * raw-db — open a better-sqlite3 Database for FTS and raw-SQL operations.
 *
 * Prisma uses the driver adapter pattern (@prisma/adapter-better-sqlite3)
 * which wraps the underlying Database. For FTS5 operations in @supernote/search,
 * we need direct access to the better-sqlite3 Database handle.
 *
 * We open a second connection to the same SQLite file. SQLite supports multiple
 * readers and WAL allows concurrent writer+readers, so this is safe.
 * The raw connection is read-write so we can install FTS triggers.
 */

import BetterSQLite3 from "better-sqlite3";
import type Database from "better-sqlite3";
import { installFts } from "@supernote/search";
import { logger } from "../logger.js";

/** Open a raw better-sqlite3 connection and install FTS triggers. */
export function openRawDb(dbPath: string): Database.Database {
  const db = new BetterSQLite3(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  // Install FTS5 virtual table and triggers (idempotent — uses IF NOT EXISTS)
  installFts(db);

  logger.info("Raw DB opened and FTS installed", { dbPath });
  return db;
}

/** Close the raw database connection safely. */
export function closeRawDb(db: Database.Database): void {
  try {
    db.close();
    logger.info("Raw DB closed");
  } catch (err) {
    logger.warn("Failed to close raw DB", { err: String(err) });
  }
}
