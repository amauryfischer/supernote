/**
 * sqlite-adapter — wraps @sqlite.org/sqlite-wasm behind the sql.js Database
 * surface the rest of the vault-worker code expects.
 *
 * Why: migrating call-sites away from sql.js shapes (QueryExecResult[],
 * db.exec(sql, params), db.run(sql, params), db.export()) would touch
 * 2500+ lines across worker-router / seed / migration files. This adapter
 * keeps those call-sites untouched while swapping the underlying engine to
 * the official build (OPFS SAH pool VFS, FTS5 included, page-level I/O).
 *
 * Persistence model:
 *  - DB lives in an OPFS-backed SAH pool ("supernote-vfs" directory).
 *  - For vault-folder portability (Git-syncable index.db), the worker mirrors
 *    bytes to FSA via `exportBytes()` and re-imports via `importBytes()` on
 *    boot when the SAH pool is empty.
 */

import sqlite3InitModule, {
  type OpfsSAHPoolDatabase,
  type SAHPoolUtil,
  type Sqlite3Static,
} from "@sqlite.org/sqlite-wasm";

export type SqlValue = string | number | null | Uint8Array;

export interface QueryExecResult {
  columns: string[];
  values: SqlValue[][];
}

/**
 * Subset of sql.js' Database API that the vault worker actually calls. Kept
 * intentionally narrow so future engine swaps stay surgical.
 */
export interface Database {
  exec(sql: string, params?: SqlValue[]): QueryExecResult[];
  run(sql: string, params?: SqlValue[]): Database;
  export(): Uint8Array;
  close(): void;
}

const DEFAULT_DB_PATH = "/index.db";
const DEFAULT_VFS_NAME = "supernote-vfs";

interface BootContext {
  sqlite3: Sqlite3Static;
  pool: SAHPoolUtil;
  dbPath: string;
}

let bootPromise: Promise<BootContext> | null = null;

/**
 * Le worker sortant tient encore les handles OPFS quand le nouveau démarre :
 * un rechargement de page échouait alors sur `NoModificationAllowedError`, et
 * il fallait recharger une seconde fois. Les handles se libèrent dès que
 * l'ancien worker meurt — quelques dixièmes de seconde suffisent.
 */
function isHandleContention(err: unknown): boolean {
  const msg = err instanceof Error ? `${err.name} ${err.message}` : String(err);
  return /NoModificationAllowed|Access Handle/i.test(msg);
}

const POOL_RETRY_DELAYS_MS = [120, 200, 320, 500, 800, 1200];

async function installPoolWithRetry(
  sqlite3: Awaited<ReturnType<typeof sqlite3InitModule>>,
): Promise<SAHPoolUtil> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await sqlite3.installOpfsSAHPoolVfs({
        name: DEFAULT_VFS_NAME,
        initialCapacity: 12,
      });
    } catch (err) {
      const delay = POOL_RETRY_DELAYS_MS[attempt];
      if (delay === undefined || !isHandleContention(err)) throw err;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

async function boot(): Promise<BootContext> {
  if (bootPromise) return bootPromise;
  bootPromise = (async () => {
    // Emscripten reads `print`/`printErr` off the Module argument that the
    // init wrapper synthesises internally; the public declaration omits the
    // parameter list to avoid leaking that detail (see the package note about
    // sqlite-wasm#129). Calling without args is the supported form.
    const sqlite3 = await sqlite3InitModule();
    // Capacity covers main DB + journal + WAL + a couple of spare slots so
    // VACUUM INTO / temp work doesn't exhaust the pool.
    const pool = await installPoolWithRetry(sqlite3);
    return { sqlite3, pool, dbPath: DEFAULT_DB_PATH };
  })();
  // Une promesse rejetée resterait en cache et condamnerait toute tentative
  // ultérieure de la session : c'est ce qui obligeait à recharger deux fois.
  bootPromise.catch(() => {
    bootPromise = null;
  });
  return bootPromise;
}

class SqliteWasmAdapter implements Database {
  private readonly _ctx: BootContext;
  private _db: OpfsSAHPoolDatabase | null;

  constructor(ctx: BootContext, db: OpfsSAHPoolDatabase) {
    this._ctx = ctx;
    this._db = db;
  }

  private get db(): OpfsSAHPoolDatabase {
    if (!this._db) throw new Error("Database is closed");
    return this._db;
  }

  exec(sql: string, params?: SqlValue[]): QueryExecResult[] {
    const columnNames: string[] = [];
    const resultRows: SqlValue[][] = [];
    // bind is optional — pass only when caller supplied params, otherwise
    // multi-statement DDL strings (which can't be parameterized) break.
    const opts: Record<string, unknown> = {
      sql,
      rowMode: "array",
      columnNames,
      resultRows,
    };
    if (params && params.length > 0) opts["bind"] = params;
    this.db.exec(opts as Parameters<OpfsSAHPoolDatabase["exec"]>[0]);
    if (columnNames.length === 0 && resultRows.length === 0) return [];
    return [{ columns: columnNames, values: resultRows }];
  }

  run(sql: string, params?: SqlValue[]): Database {
    if (params && params.length > 0) {
      this.db.exec({ sql, bind: params });
    } else {
      // Multi-statement DDL strings come through here (SCHEMA_SQL, PRAGMA …).
      this.db.exec(sql);
    }
    return this;
  }

  export(): Uint8Array {
    // sqlite3_js_db_export reads the live pages from the VFS — no need to
    // close/reopen. Returns a fresh Uint8Array copy.
    const ptr = this.db.pointer;
    if (ptr === undefined) throw new Error("Database pointer unavailable");
    return this._ctx.sqlite3.capi.sqlite3_js_db_export(ptr);
  }

  close(): void {
    if (this._db) {
      this._db.close();
      this._db = null;
    }
  }
}

/**
 * Open the vault DB. If `seedBytes` is provided AND the OPFS pool has no
 * existing file at the target path, those bytes are imported first (used to
 * bootstrap from a vault folder's `.supernote/index.db` on a fresh device).
 */
/**
 * Build a valid "empty" SQLite database as a byte array. The SAH pool's
 * `importDb` rejects 0-byte and otherwise-invalid payloads with
 * "Byte array size is invalid for an SQLite db.", so we materialise a real
 * fresh DB in memory (default page size, no user tables) and export its
 * canonical bytes. Used to (re-)allocate a pool slot after `pool.unlink`.
 */
function freshEmptySqliteBytes(ctx: BootContext): Uint8Array {
  // sqlite3.oo1.DB(":memory:") creates an in-memory DB on the heap; export
  // dumps the page-1 header + any subsequent pages so the pool sees a
  // canonical SQLite layout.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sqlite3 = ctx.sqlite3 as any;
  const mem = new sqlite3.oo1.DB(":memory:", "ct");
  try {
    return sqlite3.capi.sqlite3_js_db_export(mem.pointer);
  } finally {
    mem.close();
  }
}

export async function openDatabase(seedBytes?: Uint8Array | null): Promise<Database> {
  const ctx = await boot();
  const existing = ctx.pool.getFileNames().includes(ctx.dbPath);
  if (!existing && seedBytes && seedBytes.byteLength > 0) {
    console.info(
      `[sqlite-adapter] importing ${seedBytes.byteLength} seed bytes into ${ctx.dbPath}`,
    );
    await ctx.pool.importDb(ctx.dbPath, seedBytes);
  } else if (!existing) {
    // No slot allocated AND no seed bytes — happens right after `clearOpfsDb`
    // (vault switch) when the FSA mirror is also absent. Allocate a fresh
    // slot by importing a canonical empty SQLite DB so `OpfsSAHPoolDb` has
    // something to open. (Without this, the constructor throws
    // NotFoundError because the SAH pool requires a slot per filename.)
    const empty = freshEmptySqliteBytes(ctx);
    console.info(`[sqlite-adapter] seeding empty slot at ${ctx.dbPath} (${empty.byteLength} bytes)`);
    await ctx.pool.importDb(ctx.dbPath, empty);
  }
  const db = new ctx.pool.OpfsSAHPoolDb(ctx.dbPath);
  return new SqliteWasmAdapter(ctx, db);
}

/**
 * Read the raw SQLite file bytes from the OPFS SAH pool — used to mirror the
 * DB into the vault folder via FSA for Git-syncability. Caller is responsible
 * for ensuring no writes are in flight; the helper deliberately bypasses the
 * Database wrapper so it can be called even while the DB is open.
 */
export async function exportBytes(): Promise<Uint8Array> {
  const ctx = await boot();
  return ctx.pool.exportFile(ctx.dbPath);
}

/**
 * Force-import bytes into the OPFS SAH pool, overwriting any existing
 * content. Must be called BEFORE openDatabase() in the worker bootstrap —
 * the DB cannot be open when its underlying file is replaced.
 */
export async function importBytes(bytes: Uint8Array): Promise<void> {
  const ctx = await boot();
  await ctx.pool.importDb(ctx.dbPath, bytes);
}

/**
 * True iff the OPFS pool already has the vault DB file. Lets the worker
 * decide whether to seed from FSA or trust the OPFS-resident copy.
 */
export async function hasOpfsDb(): Promise<boolean> {
  const ctx = await boot();
  return ctx.pool.getFileNames().includes(ctx.dbPath);
}

/**
 * Drop the OPFS-resident DB. Called when the user switches vaults so the new
 * vault's bytes don't co-exist with the previous one's. Safe to call when no
 * file exists.
 *
 * After unlink, the SAH slot is released. `openDatabase()` then sees the
 * file is missing and re-allocates the slot via `pool.importDb` with empty
 * bytes (see openDatabase) — that's required because the SAH pool VFS
 * needs an allocated slot per filename before `new OpfsSAHPoolDb(path)`
 * can succeed.
 */
export async function clearOpfsDb(): Promise<void> {
  const ctx = await boot();
  if (ctx.pool.getFileNames().includes(ctx.dbPath)) {
    ctx.pool.unlink(ctx.dbPath);
    console.info(`[sqlite-adapter] clearOpfsDb: removed ${ctx.dbPath}`);
  }
}
