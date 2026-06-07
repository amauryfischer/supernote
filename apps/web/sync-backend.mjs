/**
 * sync-backend — realtime online-sync server for the Supernote PWA.
 *
 * This is the "online alternative" persistence option: when the deployment has
 * a database configured (`DATABASE_URL` present), the server keeps an
 * append-only entity op-log and fans new ops out to every connected device
 * over Server-Sent Events. Devices push their local changes via `POST`. The
 * result is realtime sync between web and Android-installed PWA, with no extra
 * runtime dependency beyond `better-sqlite3` (already in the workspace).
 *
 * Activation: the backend is only constructed when `DATABASE_URL` is set, so a
 * plain static deployment (the default) stays exactly as before — zero new
 * surface, zero new failure modes.
 *
 * Endpoints (all under `/api/sync/`):
 *   GET  /info                        → { enabled, requiresToken }
 *   GET  /stream?vault&since&clientId  → SSE: hello, ops, ping
 *   POST /push  { vault, clientId, ops } → { headSeq, acks }
 *   GET  /pull?vault&since             → { headSeq, ops }   (SSE-less fallback)
 *
 * Storage: a single SQLite file (`SYNC_DB_PATH`, or derived from a `file:`
 * `DATABASE_URL`, else `sync-data.db`). The op-log is global-monotonic in
 * `seq`; clients filter by their `vault` room key and track the highest seq
 * they've applied.
 *
 * Auth: optional shared secret via `SYNC_TOKEN`. When set, every request must
 * present it (header `x-sync-token` or `?token=`).
 */

import Database from "better-sqlite3";
import { fileURLToPath } from "node:url";

const HEARTBEAT_MS = 25_000;
const REPLAY_BATCH = 500;

function resolveDbPath() {
  if (process.env.SYNC_DB_PATH) return process.env.SYNC_DB_PATH;
  const url = process.env.DATABASE_URL ?? "";
  if (url.startsWith("file:")) {
    try {
      return url.includes("://") ? fileURLToPath(url) : url.slice("file:".length);
    } catch {
      return url.slice("file:".length);
    }
  }
  // Non-file (e.g. a Postgres URL): we don't speak that protocol here, but the
  // user signalled "a database is present", so keep a durable local op-log.
  if (url && !url.includes("://")) return url;
  return "sync-data.db";
}

/**
 * Build the sync backend. Returns `{ enabled, handle }`.
 *
 * `handle(req, res)` returns true when it owns (and has answered) the request,
 * false when the path isn't a sync route and the caller should continue.
 */
export function createSyncBackend() {
  const enabled = !!process.env.DATABASE_URL;
  if (!enabled) {
    return { enabled: false, handle: () => false };
  }

  const token = process.env.SYNC_TOKEN || "";
  const dbPath = resolveDbPath();
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
  `);

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

  console.log(`[sync] online realtime sync ENABLED (op-log at ${dbPath})`);

  // vault → Set<res> of live SSE subscribers.
  const subscribers = new Map();

  function subscribe(vault, res) {
    let set = subscribers.get(vault);
    if (!set) {
      set = new Set();
      subscribers.set(vault, set);
    }
    set.add(res);
    return () => {
      const s = subscribers.get(vault);
      if (!s) return;
      s.delete(res);
      if (s.size === 0) subscribers.delete(vault);
    };
  }

  function rowToStoredOp(r) {
    return {
      seq: r.seq,
      opId: r.opId,
      clientId: r.clientId,
      kind: r.kind,
      entityId: r.entityId,
      ts: r.ts,
      payload: r.payload ? JSON.parse(r.payload) : undefined,
    };
  }

  function headSeq(vault) {
    return headStmt.get(vault).head;
  }

  function sseSend(res, obj) {
    res.write(`data: ${JSON.stringify(obj)}\n\n`);
  }

  function broadcast(vault, storedOps) {
    const set = subscribers.get(vault);
    if (!set || set.size === 0) return;
    const head = headSeq(vault);
    const payload = { type: "ops", headSeq: head, ops: storedOps };
    for (const res of set) {
      try {
        sseSend(res, payload);
      } catch {
        /* dropped on next heartbeat */
      }
    }
  }

  // ── helpers ──────────────────────────────────────────────────────────────

  function authed(req, url) {
    if (!token) return true;
    const provided = req.headers["x-sync-token"] || url.searchParams.get("token");
    return provided === token;
  }

  function sendJson(res, status, body) {
    const data = JSON.stringify(body);
    res.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "content-type, x-sync-token",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Cache-Control": "no-store",
    });
    res.end(data);
  }

  function readBody(req) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      let size = 0;
      req.on("data", (c) => {
        size += c.length;
        if (size > 32 * 1024 * 1024) {
          reject(new Error("payload too large"));
          req.destroy();
          return;
        }
        chunks.push(c);
      });
      req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
      req.on("error", reject);
    });
  }

  const persistMany = db.transaction((vault, ops) => {
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
        // Already seen (idempotent) — return the existing seq in the ack.
        const existing = findStmt.get(vault, op.opId);
        seq = existing ? existing.seq : 0;
      }
      acks.push({ opId: op.opId, seq });
    }
    return { stored, acks };
  });

  // ── request handler ────────────────────────────────────────────────────────

  async function handle(req, res) {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    const path = url.pathname;
    if (!path.startsWith("/api/sync/")) return false;

    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "content-type, x-sync-token",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      });
      res.end();
      return true;
    }

    if (path === "/api/sync/info") {
      sendJson(res, 200, { enabled: true, requiresToken: !!token });
      return true;
    }

    if (!authed(req, url)) {
      sendJson(res, 401, { error: "unauthorized" });
      return true;
    }

    if (path === "/api/sync/pull" && req.method === "GET") {
      const vault = url.searchParams.get("vault") ?? "";
      const since = Number(url.searchParams.get("since") ?? "0") || 0;
      if (!vault) {
        sendJson(res, 400, { error: "missing vault" });
        return true;
      }
      const ops = sinceStmt.all(vault, since, REPLAY_BATCH).map(rowToStoredOp);
      sendJson(res, 200, { headSeq: headSeq(vault), ops });
      return true;
    }

    if (path === "/api/sync/push" && req.method === "POST") {
      let parsed;
      try {
        parsed = JSON.parse(await readBody(req));
      } catch {
        sendJson(res, 400, { error: "invalid json" });
        return true;
      }
      const vault = parsed?.vault;
      const ops = Array.isArray(parsed?.ops) ? parsed.ops : [];
      if (!vault || typeof vault !== "string") {
        sendJson(res, 400, { error: "missing vault" });
        return true;
      }
      const { stored, acks } = persistMany(vault, ops);
      if (stored.length > 0) broadcast(vault, stored);
      sendJson(res, 200, { headSeq: headSeq(vault), acks });
      return true;
    }

    if (path === "/api/sync/stream" && req.method === "GET") {
      const vault = url.searchParams.get("vault") ?? "";
      const since = Number(url.searchParams.get("since") ?? "0") || 0;
      if (!vault) {
        sendJson(res, 400, { error: "missing vault" });
        return true;
      }
      res.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "Access-Control-Allow-Origin": "*",
        "X-Accel-Buffering": "no",
      });
      sseSend(res, { type: "hello", headSeq: headSeq(vault) });

      // Replay the backlog since the client's cursor in batches.
      let cursor = since;
      for (;;) {
        const batch = sinceStmt.all(vault, cursor, REPLAY_BATCH).map(rowToStoredOp);
        if (batch.length === 0) break;
        sseSend(res, { type: "ops", headSeq: headSeq(vault), ops: batch });
        cursor = batch[batch.length - 1].seq;
        if (batch.length < REPLAY_BATCH) break;
      }

      const unsubscribe = subscribe(vault, res);
      const heartbeat = setInterval(() => {
        try {
          sseSend(res, { type: "ping" });
        } catch {
          /* will be cleaned up on close */
        }
      }, HEARTBEAT_MS);

      const cleanup = () => {
        clearInterval(heartbeat);
        unsubscribe();
      };
      req.on("close", cleanup);
      res.on("error", cleanup);
      return true;
    }

    sendJson(res, 404, { error: "unknown sync route" });
    return true;
  }

  return { enabled: true, handle };
}
