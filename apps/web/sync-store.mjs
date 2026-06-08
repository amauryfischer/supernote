/**
 * sync-store — storage layer for the online-sync op-log, with two engines
 * behind one async interface:
 *
 *   - **SQLite** (better-sqlite3): `DATABASE_URL=file:…` / `SYNC_DB_PATH`.
 *     Fine for self-hosting on a persistent disk; on an ephemeral filesystem
 *     (Scalingo) the log dies with every redeploy and only the epoch
 *     mechanism keeps devices converging.
 *   - **PostgreSQL** (pg): `DATABASE_URL=postgres://…`. The durable option
 *     for PaaS deployments — a Scalingo PostgreSQL addon survives redeploys,
 *     so the op-log (and the epoch) actually persist.
 *
 * Interface (all async so the backend code is engine-agnostic):
 *   epoch()                        → string (minted once per database)
 *   insertMany(vault, ops)         → { stored: StoredOp[], acks }
 *   opsSince(vault, since, limit)  → StoredOp[]
 *   headSeq(vault)                 → number
 *   compact(cutoffMs)              → number of purged rows
 *   kind                           → "sqlite" | "postgres"
 */

import { fileURLToPath } from "node:url";

function mintEpoch() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function rowToStoredOp(r) {
  return {
    seq: Number(r.seq),
    opId: r.opId ?? r.opid,
    clientId: r.clientId ?? r.clientid,
    kind: r.kind,
    entityId: r.entityId ?? r.entityid,
    ts: Number(r.ts),
    payload: r.payload ? JSON.parse(r.payload) : undefined,
  };
}

// ── SQLite engine ─────────────────────────────────────────────────────────────

function resolveSqlitePath() {
  if (process.env.SYNC_DB_PATH) return process.env.SYNC_DB_PATH;
  const url = process.env.DATABASE_URL ?? "";
  if (url.startsWith("file:")) {
    try {
      return url.includes("://") ? fileURLToPath(url) : url.slice("file:".length);
    } catch {
      return url.slice("file:".length);
    }
  }
  if (url && !url.includes("://")) return url;
  return "sync-data.db";
}

async function createSqliteStore() {
  const { default: Database } = await import("better-sqlite3");
  const dbPath = resolveSqlitePath();
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS op (
      seq       INTEGER PRIMARY KEY AUTOINCREMENT,
      vault     TEXT NOT NULL,
      opId      TEXT NOT NULL,
      clientId  TEXT NOT NULL,
      kind      TEXT NOT NULL,
      entityId  TEXT NOT NULL,
      ts        INTEGER NOT NULL,
      payload   TEXT,
      createdAt INTEGER NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS op_vault_opid ON op (vault, opId);
    CREATE INDEX IF NOT EXISTS op_vault_seq ON op (vault, seq);
    CREATE INDEX IF NOT EXISTS op_vault_entity ON op (vault, entityId, seq);
    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `);

  let epoch = db.prepare(`SELECT value FROM meta WHERE key = 'epoch'`).get()?.value;
  if (!epoch) {
    epoch = mintEpoch();
    db.prepare(`INSERT OR REPLACE INTO meta (key, value) VALUES ('epoch', ?)`).run(epoch);
  }

  const insertStmt = db.prepare(
    `INSERT OR IGNORE INTO op (vault, opId, clientId, kind, entityId, ts, payload, createdAt)
     VALUES (@vault, @opId, @clientId, @kind, @entityId, @ts, @payload, @createdAt)`,
  );
  const findStmt = db.prepare(`SELECT seq FROM op WHERE vault = ? AND opId = ?`);
  const sinceStmt = db.prepare(
    `SELECT seq, opId, clientId, kind, entityId, ts, payload
       FROM op WHERE vault = ? AND seq > ? ORDER BY seq ASC LIMIT ?`,
  );
  const headStmt = db.prepare(`SELECT COALESCE(MAX(seq), 0) AS head FROM op WHERE vault = ?`);
  const compactStmt = db.prepare(
    `DELETE FROM op
      WHERE createdAt < ?
        AND seq NOT IN (SELECT MAX(seq) FROM op GROUP BY vault, entityId)`,
  );

  const insertMany = db.transaction((vault, ops) => {
    const stored = [];
    const acks = [];
    const createdAt = Date.now();
    for (const op of ops) {
      if (!op || typeof op.opId !== "string" || typeof op.entityId !== "string") continue;
      const info = insertStmt.run({
        vault,
        opId: op.opId,
        clientId: String(op.clientId ?? ""),
        kind: op.kind === "delete" ? "delete" : "upsert",
        entityId: op.entityId,
        ts: Number(op.ts) || createdAt,
        payload: op.payload ? JSON.stringify(op.payload) : null,
        createdAt,
      });
      let seq;
      if (info.changes > 0) {
        seq = Number(info.lastInsertRowid);
        stored.push({ ...op, seq });
      } else {
        const existing = findStmt.get(vault, op.opId);
        seq = existing ? Number(existing.seq) : 0;
      }
      acks.push({ opId: op.opId, seq });
    }
    return { stored, acks };
  });

  return {
    kind: "sqlite",
    label: dbPath,
    epoch: () => epoch,
    insertMany: async (vault, ops) => insertMany(vault, ops),
    opsSince: async (vault, since, limit) =>
      sinceStmt.all(vault, since, limit).map(rowToStoredOp),
    headSeq: async (vault) => Number(headStmt.get(vault).head),
    compact: async (cutoffMs) => compactStmt.run(cutoffMs).changes,
  };
}

// ── PostgreSQL engine ─────────────────────────────────────────────────────────

async function createPgStore(url) {
  const { default: pg } = await import("pg");
  const pool = new pg.Pool({ connectionString: url, max: 5 });

  await pool.query(`
    CREATE TABLE IF NOT EXISTS sync_op (
      seq       BIGSERIAL PRIMARY KEY,
      vault     TEXT NOT NULL,
      opid      TEXT NOT NULL,
      clientid  TEXT NOT NULL,
      kind      TEXT NOT NULL,
      entityid  TEXT NOT NULL,
      ts        BIGINT NOT NULL,
      payload   TEXT,
      createdat BIGINT NOT NULL,
      UNIQUE (vault, opid)
    );
    CREATE INDEX IF NOT EXISTS sync_op_vault_seq ON sync_op (vault, seq);
    CREATE INDEX IF NOT EXISTS sync_op_vault_entity ON sync_op (vault, entityid, seq);
    CREATE TABLE IF NOT EXISTS sync_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `);

  // Mint-once epoch, race-safe across concurrent boots (ON CONFLICT keeps the
  // first writer's value; everyone re-reads).
  await pool.query(
    `INSERT INTO sync_meta (key, value) VALUES ('epoch', $1)
     ON CONFLICT (key) DO NOTHING`,
    [mintEpoch()],
  );
  const epochRow = await pool.query(`SELECT value FROM sync_meta WHERE key = 'epoch'`);
  const epoch = epochRow.rows[0].value;

  async function insertMany(vault, ops) {
    const client = await pool.connect();
    const stored = [];
    const acks = [];
    const createdAt = Date.now();
    try {
      await client.query("BEGIN");
      for (const op of ops) {
        if (!op || typeof op.opId !== "string" || typeof op.entityId !== "string") continue;
        const inserted = await client.query(
          `INSERT INTO sync_op (vault, opid, clientid, kind, entityid, ts, payload, createdat)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           ON CONFLICT (vault, opid) DO NOTHING
           RETURNING seq`,
          [
            vault,
            op.opId,
            String(op.clientId ?? ""),
            op.kind === "delete" ? "delete" : "upsert",
            op.entityId,
            Number(op.ts) || createdAt,
            op.payload ? JSON.stringify(op.payload) : null,
            createdAt,
          ],
        );
        let seq;
        if (inserted.rows.length > 0) {
          seq = Number(inserted.rows[0].seq);
          stored.push({ ...op, seq });
        } else {
          const existing = await client.query(
            `SELECT seq FROM sync_op WHERE vault = $1 AND opid = $2`,
            [vault, op.opId],
          );
          seq = existing.rows.length > 0 ? Number(existing.rows[0].seq) : 0;
        }
        acks.push({ opId: op.opId, seq });
      }
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
    return { stored, acks };
  }

  return {
    kind: "postgres",
    label: url.replace(/:\/\/[^@/]*@/, "://***@"),
    epoch: () => epoch,
    insertMany,
    opsSince: async (vault, since, limit) => {
      const res = await pool.query(
        `SELECT seq, opid, clientid, kind, entityid, ts, payload
           FROM sync_op WHERE vault = $1 AND seq > $2 ORDER BY seq ASC LIMIT $3`,
        [vault, since, limit],
      );
      return res.rows.map(rowToStoredOp);
    },
    headSeq: async (vault) => {
      const res = await pool.query(
        `SELECT COALESCE(MAX(seq), 0) AS head FROM sync_op WHERE vault = $1`,
        [vault],
      );
      return Number(res.rows[0].head);
    },
    compact: async (cutoffMs) => {
      const res = await pool.query(
        `DELETE FROM sync_op
          WHERE createdat < $1
            AND seq NOT IN (SELECT MAX(seq) FROM sync_op GROUP BY vault, entityid)`,
        [cutoffMs],
      );
      return res.rowCount ?? 0;
    },
  };
}

// ── Engine selection ──────────────────────────────────────────────────────────

/** Pick the engine from DATABASE_URL: postgres URLs → pg, anything else → sqlite. */
export async function createSyncStore() {
  const url = process.env.DATABASE_URL ?? "";
  if (/^postgres(ql)?:\/\//.test(url)) return createPgStore(url);
  return createSqliteStore();
}
