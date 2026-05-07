/**
 * vault-worker — Web Worker entry point for PWA mode.
 *
 * Responsibilities:
 * - Accept INIT_VAULT message with FSA handle
 * - Initialize sql.js SQLite in OPFS or FSA
 * - Apply schema (idempotent)
 * - Expose tRPC-like router via postMessage
 * - Persist DB on every mutation (debounced)
 * - Poll for file changes every 30s (fallback for FileSystemObserver)
 */

/// <reference lib="webworker" />

import initSqlJs from "sql.js";
import type { Database } from "sql.js";
import { SCHEMA_SQL_BASE } from "./db-schema";
import { loadDbFromFsa, saveDbToFsa, loadDbFromOpfs, saveDbToOpfs } from "./db-persistence";
import { buildRouter, RouteHandler } from "./worker-router";
import type {
  WorkerInboundMessage,
  WorkerRequest,
  InitVaultMessage,
} from "./worker-protocol";

// ── State ─────────────────────────────────────────────────────────────────────

let db: Database | null = null;
let vaultHandle: FileSystemDirectoryHandle | null = null;
let vaultId: string | null = null;
let router: Record<string, RouteHandler> = {};
let persistTimer: ReturnType<typeof setTimeout> | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;

// ── DB init ───────────────────────────────────────────────────────────────────

async function initSqlite(handle: FileSystemDirectoryHandle): Promise<Database> {
  const SQL = await initSqlJs({
    // sql.js WASM file — served from public/ via Next.js copy-webpack-plugin
    locateFile: (file: string) => `/wasm/${file}`,
  });

  // Try loading from FSA first (vault's own .supernote/index.db)
  let bytes = await loadDbFromFsa(handle);
  if (!bytes) {
    // Try OPFS fallback
    bytes = await loadDbFromOpfs();
  }

  const database = bytes ? new SQL.Database(bytes) : new SQL.Database();

  // Migration : an earlier buggy schema created an FTS5 virtual table + 3
  // triggers in this DB even though sql.js standard build doesn't ship FTS5.
  // Any subsequent operation on `entity` would crash with "no such module: fts5".
  //
  // We can't `DROP TABLE entity_fts` (DROP on a virtual table requires the
  // module). So we directly edit sqlite_master with `PRAGMA writable_schema=ON`
  // to remove every entity_fts artefact.
  try {
    database.run(`
      PRAGMA writable_schema = ON;
      DELETE FROM sqlite_master
       WHERE name = 'entity_fts'
          OR name LIKE 'entity_fts_%'
          OR (sql IS NOT NULL AND lower(sql) LIKE '%fts5%');
      PRAGMA writable_schema = OFF;
      VACUUM;
    `);
  } catch (e) {
    console.warn("[vault-worker] FTS5 migration failed (non-fatal)", e);
  }

  database.run(SCHEMA_SQL_BASE);
  return database;
}

async function persistDb(): Promise<void> {
  if (!db || !vaultHandle) return;
  try {
    await saveDbToFsa(db, vaultHandle);
    await saveDbToOpfs(db);
  } catch (err) {
    console.warn("[vault-worker] persist failed", err);
  }
}

function schedulePersist(): void {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => void persistDb(), 500);
}

// ── Vault init ────────────────────────────────────────────────────────────────

async function handleInitVault(handle: FileSystemDirectoryHandle): Promise<void> {
  try {
    vaultHandle = handle;
    db = await initSqlite(handle);

    // Get or create vault record
    const vaultName = handle.name;
    const rootPath = handle.name; // FSA doesn't expose full path

    const existingVault = db.exec(`SELECT id FROM vault LIMIT 1`);
    if (existingVault.length && existingVault[0]?.values.length) {
      vaultId = existingVault[0].values[0]![0] as string;
    } else {
      // Create a unique vault ID using timestamp + random
      vaultId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`.toUpperCase();
      const ts = new Date().toISOString();
      db.run(
        `INSERT INTO vault (id, name, rootPath, isActive, createdAt, updatedAt) VALUES (?, ?, ?, 1, ?, ?)`,
        [vaultId, vaultName, rootPath, ts, ts],
      );
    }

    router = buildRouter(db, handle, vaultId);

    // Persist initial state
    await persistDb();

    // Start polling for file changes (30s interval)
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(() => void reindexIfNeeded(), 30_000);

    self.postMessage({
      type: "VAULT_READY",
      vaultId,
      vaultName,
      rootPath,
    });
  } catch (err) {
    self.postMessage({
      type: "VAULT_ERROR",
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// ── Polling reindex ───────────────────────────────────────────────────────────

async function reindexIfNeeded(): Promise<void> {
  if (!router["vault.reindex"]) return;
  try {
    const result = await router["vault.reindex"]!(undefined);
    const { indexed } = result as { indexed: number };
    if (indexed > 0) {
      schedulePersist();
      self.postMessage({ type: "INDEX_PROGRESS", indexed, total: indexed });
    }
  } catch {
    // Non-fatal
  }
}

// ── Message routing ───────────────────────────────────────────────────────────

async function handleRpcRequest(msg: WorkerRequest): Promise<void> {
  const { id, path, input } = msg;

  if (!db || !vaultId) {
    self.postMessage({ id, ok: false, error: "Vault not initialized" });
    return;
  }

  const handler = router[path];
  if (!handler) {
    self.postMessage({ id, ok: false, error: `Unknown procedure: ${path}` });
    return;
  }

  try {
    const result = await handler(input);
    self.postMessage({ id, ok: true, result });
    // Persist after mutations
    if (msg.type === "mutation") schedulePersist();
  } catch (err) {
    self.postMessage({
      id,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// ── Event listener ────────────────────────────────────────────────────────────

self.addEventListener("message", (event: MessageEvent<WorkerInboundMessage>) => {
  const msg = event.data;
  if (!msg) return;

  if ("type" in msg && msg.type === "INIT_VAULT") {
    void handleInitVault((msg as InitVaultMessage).handle);
  } else {
    void handleRpcRequest(msg as WorkerRequest);
  }
});
