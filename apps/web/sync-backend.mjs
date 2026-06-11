/**
 * sync-backend — realtime online-sync server for the Supernote PWA.
 *
 * This is the "online alternative" persistence option: when the deployment has
 * a database configured (`DATABASE_URL` present), the server keeps an
 * append-only entity op-log and fans new ops out to every connected device
 * over Server-Sent Events. Devices push their local changes via `POST`. The
 * result is realtime sync between web and Android-installed PWA.
 *
 * Activation: the backend is only constructed when `DATABASE_URL` is set, so a
 * plain static deployment (the default) stays exactly as before — zero new
 * surface, zero new failure modes.
 *
 * Endpoints (all under `/api/sync/`):
 *   GET  /info                        → { enabled, requiresToken, epoch }
 *   GET  /stream?vault&since&clientId  → SSE: hello, ops, ping
 *   POST /push  { vault, clientId, ops } → { headSeq, acks }
 *   GET  /pull?vault&since             → { headSeq, ops }   (SSE-less fallback)
 *
 * Storage: see `sync-store.mjs` — SQLite for `file:` URLs (self-hosting on a
 * persistent disk), PostgreSQL for `postgres://` URLs (the durable choice on
 * PaaS like Scalingo, whose container filesystem is wiped on each deploy).
 *
 * Epoch: a random id minted when the op-log database is created, exposed in
 * `/info` and the SSE `hello`. Clients reset their cursor + re-seed when it
 * changes — see the epoch guard in `online-sync/client.ts`.
 *
 * Auth: optional shared secret via `SYNC_TOKEN`. When set, every request must
 * present it (header `x-sync-token` or `?token=`).
 */

import { createSyncStore } from "./sync-store.mjs";

const HEARTBEAT_MS = 25_000;
const REPLAY_BATCH = 500;
const COMPACT_GRACE_MS = 7 * 24 * 60 * 60 * 1000;
const COMPACT_INTERVAL_MS = 6 * 60 * 60 * 1000;

/**
 * Build the sync backend. Returns `{ enabled, handle }`.
 *
 * `handle(req, res)` returns true when it owns (and has answered) the request,
 * false when the path isn't a sync route and the caller should continue.
 */
export async function createSyncBackend() {
  const enabled = !!process.env.DATABASE_URL;
  if (!enabled) {
    return { enabled: false, handle: () => false };
  }

  const token = process.env.SYNC_TOKEN || "";
  const store = await createSyncStore();
  const epoch = store.epoch();

  // ── Op-log compaction ──────────────────────────────────────────────────────
  // With entity-level last-write-wins, only the LATEST op per (vault, entity)
  // matters for convergence: a late client replaying a compacted log still
  // materialises the exact same final state. Superseded ops older than the
  // grace window are purged so the log (and the initial replay) stays bounded.
  async function compact() {
    try {
      const removed = await store.compact(Date.now() - COMPACT_GRACE_MS);
      if (removed > 0) console.log(`[sync] compacted ${removed} superseded op(s)`);
    } catch (err) {
      console.warn("[sync] compaction failed", err);
    }
  }
  void compact();
  const compactTimer = setInterval(() => void compact(), COMPACT_INTERVAL_MS);
  // Don't hold the process open just for the compactor.
  if (typeof compactTimer.unref === "function") compactTimer.unref();

  console.log(
    `[sync] online realtime sync ENABLED (${store.kind} op-log at ${store.label}, epoch ${epoch})`,
  );

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

  function sseSend(res, obj) {
    res.write(`data: ${JSON.stringify(obj)}\n\n`);
  }

  async function broadcast(vault, storedOps) {
    const set = subscribers.get(vault);
    if (!set || set.size === 0) return;
    const head = await store.headSeq(vault);
    // Chunked: a device's initial seed can push thousands of ops in one POST
    // (body cap 32 MB) — broadcasting them back as ONE SSE frame forces a
    // multi-second JSON.parse on every subscriber's main thread (and on the
    // seeder itself, which parses its own echo before discarding it). Mirror
    // the replay batch size so live frames stay bounded.
    for (let i = 0; i < storedOps.length; i += REPLAY_BATCH) {
      const payload = {
        type: "ops",
        headSeq: head,
        ops: storedOps.slice(i, i + REPLAY_BATCH),
      };
      for (const res of set) {
        try {
          sseSend(res, payload);
        } catch {
          /* dropped on next heartbeat */
        }
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
      sendJson(res, 200, { enabled: true, requiresToken: !!token, epoch });
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
      const ops = await store.opsSince(vault, since, REPLAY_BATCH);
      sendJson(res, 200, { headSeq: await store.headSeq(vault), ops });
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
      const { stored, acks } = await store.insertMany(vault, ops);
      if (stored.length > 0) await broadcast(vault, stored);
      sendJson(res, 200, { headSeq: await store.headSeq(vault), acks });
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
      sseSend(res, { type: "hello", headSeq: await store.headSeq(vault), epoch });

      // Replay the backlog since the client's cursor in batches.
      let cursor = since;
      for (;;) {
        const batch = await store.opsSince(vault, cursor, REPLAY_BATCH);
        if (batch.length === 0) break;
        sseSend(res, { type: "ops", headSeq: await store.headSeq(vault), ops: batch });
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
