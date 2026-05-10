/**
 * vault-worker — Web Worker entry point for PWA mode.
 *
 * Responsibilities:
 * - Accept INIT_VAULT message with FSA handle (idempotent — repeat calls
 *   for the same handle just re-emit VAULT_READY)
 * - Initialize sql.js SQLite in OPFS or FSA
 * - Apply schema (idempotent)
 * - Expose tRPC-like router via postMessage
 * - Persist DB before acknowledging every mutation (no debounce) and serialize
 *   concurrent persists through `persistChain` so FSA writable streams don't race
 * - Accept FLUSH bootstrap message to force a synchronous persist on
 *   navigation / page-hide
 * - Poll for file changes every 30s (fallback for FileSystemObserver)
 */

/// <reference lib="webworker" />

import initSqlJs from "sql.js";
import type { Database } from "sql.js";
import { SCHEMA_SQL_BASE } from "./db-schema";
import { loadDbFromFsa, saveDbToFsa, loadDbFromOpfs, saveDbToOpfs } from "./db-persistence";
import { seedDefaults } from "./seed-default-types";
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
let vaultName: string | null = null;
let rootPath: string | null = null;
let router: Record<string, RouteHandler> = {};
let pollTimer: ReturnType<typeof setInterval> | null = null;
// Tracks the currently in-flight persist so concurrent mutations queue up
// behind it instead of racing the FSA writable. Initial value is a resolved
// promise so the first awaiter just falls through.
let persistChain: Promise<void> = Promise.resolve();

// ── DB init ───────────────────────────────────────────────────────────────────

async function initSqlite(handle: FileSystemDirectoryHandle): Promise<Database> {
  console.info("[init.sqlite] fetching WASM");
  const wasmResponse = await fetch(`${self.location.origin}/wasm/sql-wasm.wasm`);
  if (!wasmResponse.ok) {
    throw new Error(`WASM fetch failed: ${wasmResponse.status} ${wasmResponse.statusText}`);
  }
  const wasmBinary = new Uint8Array(await wasmResponse.arrayBuffer());

  console.info("[init.sqlite] initSqlJs");
  const SQL = await initSqlJs({ wasmBinary } as Parameters<typeof initSqlJs>[0]);

  console.info("[init.sqlite] loadDbFromFsa…");
  let bytes = await loadDbFromFsa(handle);
  if (!bytes) {
    console.info("[init.sqlite] loadDbFromOpfs (fallback)…");
    bytes = await loadDbFromOpfs();
  }
  console.info(`[init.sqlite] bytes loaded? ${bytes ? bytes.byteLength : "no"}`);

  console.info("[init.sqlite] instantiate SQL.Database");
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

  console.info("[init.sqlite] running SCHEMA_SQL_BASE");
  database.run(SCHEMA_SQL_BASE);
  console.info("[init.sqlite] done");
  return database;
}

async function persistDb(): Promise<void> {
  if (!db || !vaultHandle) {
    console.warn(
      `[persist] persistDb skipped — db=${!!db} vaultHandle=${!!vaultHandle}. Bytes NOT written.`,
    );
    return;
  }
  try {
    const exported = db.export();
    await saveDbToFsa(db, vaultHandle);
    await saveDbToOpfs(db);
    console.info(`[persist] saved ${exported.byteLength} bytes to FSA + OPFS`);
  } catch (err) {
    console.error("[vault-worker] persist failed — DATA WILL BE LOST ON RELOAD", err);
  }
}

/**
 * Persist immediately (no debounce) and serialize through `persistChain`
 * so back-to-back mutations don't race the FSA writable stream. We deliberately
 * do NOT debounce: a 500ms window meant a navigation right after an entity
 * create could re-INIT the worker and reload an empty DB before the write
 * landed. FSA writes are async + small, so the cost of writing on every
 * mutation is negligible compared to losing data.
 */
function schedulePersist(): Promise<void> {
  const next = persistChain.then(() => persistDb());
  // Swallow rejection so the chain doesn't poison subsequent persists.
  persistChain = next.catch(() => undefined);
  return next;
}

/** Force-flush any pending persist and wait for it to complete. */
async function flushPersist(): Promise<void> {
  await schedulePersist();
}

// ── Vault init ────────────────────────────────────────────────────────────────

async function isSameVaultHandle(
  current: FileSystemDirectoryHandle | null,
  next: FileSystemDirectoryHandle,
): Promise<boolean> {
  if (!current) return false;
  // Cheap pre-check first: name must match.
  if (current.name !== next.name) return false;
  // FSA exposes isSameEntry — preferred when available.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fn = (current as any).isSameEntry;
  if (typeof fn === "function") {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return await (current as any).isSameEntry(next);
    } catch {
      return false;
    }
  }
  // Fallback: identity / name equality already passed.
  return current === next;
}

async function handleInitVault(handle: FileSystemDirectoryHandle): Promise<void> {
  try {
    // Idempotency: if the same vault is already initialized, just re-emit
    // VAULT_READY and bail. Without this, every navigation re-fires INIT
    // which reloads the DB from FSA — a debounced persist that hadn't
    // flushed yet would be silently dropped, making freshly created
    // entities disappear.
    if (db && vaultId && (await isSameVaultHandle(vaultHandle, handle))) {
      console.info("[init] reusing existing vault", handle.name, "vaultId=", vaultId);
      self.postMessage({
        type: "VAULT_READY",
        vaultId,
        vaultName: vaultName ?? handle.name,
        rootPath: rootPath ?? handle.name,
      });
      return;
    }

    console.info("[init] full re-init from FSA, handle.name=", handle.name);
    vaultHandle = handle;
    console.info("[init] step=initSqlite");
    db = await initSqlite(handle);
    console.info("[init] step=initSqlite done");
    // Sanity: how many rows are in `entity` right after load? If this is 0
    // after a previous create+reload cycle, persistence is broken.
    try {
      const sanity = db.exec(`SELECT COUNT(*) as c FROM entity`);
      const total =
        sanity.length && sanity[0]?.values?.[0]?.[0] != null
          ? Number(sanity[0]!.values[0]![0])
          : 0;
      console.info(`[init] sanity: entity table has ${total} row(s) total after initSqlite`);
    } catch (err) {
      console.warn("[init] sanity check failed", err);
    }
    console.info("[vault-worker] sqlite ready");

    // Get or create vault record
    vaultName = handle.name;
    rootPath = handle.name; // FSA doesn't expose full path

    const existingVault = db.exec(`SELECT id FROM vault LIMIT 1`);
    const ts = new Date().toISOString();
    if (existingVault.length && existingVault[0]?.values.length) {
      vaultId = existingVault[0].values[0]![0] as string;
    } else {
      // Create a unique vault ID using timestamp + random
      vaultId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`.toUpperCase();
      db.run(
        `INSERT INTO vault (id, name, rootPath, isActive, createdAt, updatedAt) VALUES (?, ?, ?, 1, ?, ?)`,
        [vaultId, vaultName, rootPath, ts, ts],
      );
    }

    console.info("[init] step=seedDefaults");
    seedDefaults(db, vaultId, ts);
    console.info("[init] step=buildRouter");
    router = buildRouter(db, handle, vaultId);
    console.info("[init] step=buildRouter done");

    // Diagnostic: how many entities did we just load from disk?
    let loadedCount = 0;
    try {
      const countRes = db.exec(`SELECT COUNT(*) as c FROM entity WHERE vaultId = ?`, [vaultId]);
      loadedCount =
        countRes.length && countRes[0]?.values?.[0]?.[0] != null
          ? Number(countRes[0]!.values[0]![0])
          : 0;
      console.info("[init] loaded", loadedCount, "entities from FSA for vault", vaultId);
    } catch {
      // Diagnostic only — never fail init for this
    }

    // Persist initial state — saves the (possibly empty) DB so a second
    // tab / reload doesn't see "uninitialised" if the user navigates fast.
    console.info("[init] step=persistDb (initial)");
    await persistDb();
    console.info("[init] step=persistDb done");

    // Start polling for file changes (30s interval)
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(() => void reindexIfNeeded(), 30_000);

    console.info("[vault-worker] VAULT_READY about to post", { vaultId, vaultName });
    self.postMessage({
      type: "VAULT_READY",
      vaultId,
      vaultName,
      rootPath,
    });

    // Background recovery — if the DB came back empty (fresh profile,
    // corrupted index.db, …) but the vault folder still holds .md files,
    // rebuild the entity table from those files. Runs OUT-OF-BAND so it
    // can't block VAULT_READY, and emits INDEX_PROGRESS so the UI sees
    // entities populate live. Skipped silently when the DB already had
    // rows on load (loadedCount > 0).
    if (loadedCount === 0) {
      void (async () => {
        try {
          const reindex = router["vault.reindex"];
          if (!reindex) return;
          const result = (await reindex(undefined)) as { indexed?: number };
          const indexed = result?.indexed ?? 0;
          if (indexed > 0) {
            console.info(
              `[init] empty DB recovered from disk: reindexed ${indexed} entit(y/ies) from .md files`,
            );
            // Persist the recovered state immediately so a refresh after
            // recovery sees the rebuilt entities without waiting for the
            // 30 s poll cycle.
            await schedulePersist();
            self.postMessage({ type: "INDEX_PROGRESS", indexed, total: indexed });
          }
        } catch (err) {
          console.warn("[init] background reindex failed (non-fatal)", err);
        }
      })();
    }
  } catch (err) {
    console.error("[vault-worker] init failed", err);
    self.postMessage({
      type: "VAULT_ERROR",
      error: err instanceof Error ? `${err.message}\n${err.stack ?? ""}` : String(err),
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
      void schedulePersist();
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
    // For mutations, persist BEFORE acknowledging the response. This guarantees
    // the caller can safely navigate away the moment they receive `ok: true`
    // — the bytes are already on disk (FSA + OPFS).
    //
    // Defensive: also persist for any route name that *looks* like a write
    // (create/add/update/delete/set/remove/rename) regardless of the
    // declared msg.type. This protects against tRPC misconfigurations
    // (e.g. a write surfaced as `.query()` upstream) silently dropping
    // user data on navigation.
    const looksLikeMutation = /\.(create|add|update|delete|set|remove|rename|reindex)(\.|$)/i.test(
      `.${path}.`,
    );
    if (msg.type === "mutation" || looksLikeMutation) {
      await schedulePersist();
    }
    self.postMessage({ id, ok: true, result });
  } catch (err) {
    self.postMessage({
      id,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

async function handleFlush(id: string): Promise<void> {
  try {
    await flushPersist();
    self.postMessage({ id, ok: true, result: null });
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
    return;
  }
  if ("type" in msg && msg.type === "FLUSH") {
    void handleFlush((msg as { id: string }).id);
    return;
  }
  void handleRpcRequest(msg as WorkerRequest);
});
