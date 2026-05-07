/**
 * Service registry — module-level singleton container.
 *
 * Provides access to VaultManager, the current PrismaClient, the FileWatcher,
 * and the raw better-sqlite3 Database (for FTS operations that need direct
 * SQL access beyond Prisma's ORM) without needing to thread services through
 * tRPC context.
 *
 * Initialized once in index.ts before the tRPC bridge is registered.
 */

import type { VaultManager } from "./vault-manager.js";
import type { PrismaClient } from "@supernote/db";
import type { FileWatcher } from "./file-watcher.js";
import type Database from "better-sqlite3";

let _vaultManager: VaultManager | null = null;
let _fileWatcher: FileWatcher | null = null;
let _rawDb: Database.Database | null = null;

export function setVaultManager(vm: VaultManager): void {
  _vaultManager = vm;
}

export function getVaultManager(): VaultManager {
  if (!_vaultManager) throw new Error("VaultManager not initialized");
  return _vaultManager;
}

export function getCurrentPrisma(): PrismaClient | null {
  return _vaultManager?.getCurrentPrisma() ?? null;
}

export function setFileWatcher(watcher: FileWatcher): void {
  _fileWatcher = watcher;
}

export function getFileWatcher(): FileWatcher | null {
  return _fileWatcher;
}

export function setRawDb(db: Database.Database | null): void {
  _rawDb = db;
}

export function getRawDb(): Database.Database | null {
  return _rawDb;
}
