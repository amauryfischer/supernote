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
 *   GET  /info[?vault]                → { enabled, requiresToken, epoch, locked? }
 *   GET  /vaults                      → { vaults } (salons protégés seulement)
 *   POST /join  { vault, password }   → protège un salon libre, ou vérifie
 *   GET  /stream?vault&since&clientId  → SSE: hello, ops, ping
 *   POST /push  { vault, clientId, ops } → { headSeq, acks }
 *   GET  /pull?vault&since             → { headSeq, ops }   (SSE-less fallback)
 *   POST /blob?vault&path  (octets)     → { ok }  pièce jointe d'une note
 *   GET|HEAD /blob?vault&path           → octets, 404 si absente
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
 * present it (header `x-sync-token` or `?token=`). Un salon protégé (mot de
 * passe posé via `/join`) exige en plus son mot de passe dans ce même champ ;
 * un salon libre garde le comportement historique, son nom faisant office de
 * secret — c'est pourquoi `/vaults` ne liste que les salons protégés.
 *
 * Back-office : `GET /admin` liste les espaces (Basic Auth, mot de passe =
 * `ADMIN_TOKEN`). Sans `ADMIN_TOKEN`, la route n'existe pas.
 */

import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { createSyncStore } from "./sync-store.mjs";

const HEARTBEAT_MS = 25_000;
const REPLAY_BATCH = 500;
const COMPACT_GRACE_MS = 7 * 24 * 60 * 60 * 1000;
const COMPACT_INTERVAL_MS = 6 * 60 * 60 * 1000;
const MIN_PASSWORD_LENGTH = 8;
const MAX_FAILED_ATTEMPTS = 10;
const LOCKOUT_MS = 15 * 60 * 1000;

const scryptAsync = promisify(scrypt);
const sha256 = (s) => createHash("sha256").update(s).digest();

async function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = await scryptAsync(password, salt, 32);
  return `${salt.toString("hex")}:${hash.toString("hex")}`;
}

async function verifyPassword(password, record) {
  const [saltHex, hashHex] = record.split(":");
  const expected = Buffer.from(hashHex, "hex");
  const actual = await scryptAsync(password, Buffer.from(saltHex, "hex"), expected.length);
  return timingSafeEqual(actual, expected);
}

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
  const adminToken = process.env.ADMIN_TOKEN || "";
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

  function secretOf(req, url) {
    return String(req.headers["x-sync-token"] || url.searchParams.get("token") || "");
  }

  function authed(req, url) {
    return !token || secretOf(req, url) === token;
  }

  // Cache des vérifications réussies : scrypt coûte ~50 ms, payé à chaque push sinon.
  // ponytail: un mot de passe retiré en SQL direct reste accepté jusqu'au redémarrage ;
  // le changement et le retrait par l'API purgent le cache.
  const verifiedSecrets = new Set();
  const verifiedKey = (vault, secret) => `${vault}\0${sha256(secret).toString("hex")}`;

  function forgetVerifiedSecrets(vault) {
    for (const key of verifiedSecrets) if (key.startsWith(`${vault}\0`)) verifiedSecrets.delete(key);
  }

  // ponytail: compteur en mémoire, par conteneur et remis à zéro au redémarrage ;
  // passer par le store si l'app tourne un jour sur plusieurs conteneurs.
  const failures = new Map();

  // Dernier saut de X-Forwarded-For : ajouté par le routeur, le client ne peut pas le falsifier.
  function clientIp(req) {
    const hops = String(req.headers["x-forwarded-for"] ?? "").split(",").map((h) => h.trim()).filter(Boolean);
    return hops.at(-1) || req.socket?.remoteAddress || "";
  }

  // "ok" | "wrong" | "locked" : après MAX_FAILED_ATTEMPTS échecs d'une même adresse sur
  // un salon, plus aucune vérification jusqu'à LOCKOUT_MS après le premier échec.
  async function checkVaultPassword(req, vault, provided, record) {
    const key = `${vault}\0${clientIp(req)}`;
    const now = Date.now();
    const entry = failures.get(key);
    if (entry && now - entry.since > LOCKOUT_MS) failures.delete(key);
    else if (entry && entry.count >= MAX_FAILED_ATTEMPTS) return "locked";
    if (await verifyPassword(provided, record)) {
      failures.delete(key);
      return "ok";
    }
    const current = failures.get(key);
    if (current) current.count += 1;
    else failures.set(key, { count: 1, since: now });
    if (failures.size > 10_000) {
      for (const [k, v] of failures) if (now - v.since > LOCKOUT_MS) failures.delete(k);
    }
    return "wrong";
  }

  async function vaultAuthed(req, url, vault) {
    const provided = secretOf(req, url);
    if (token && provided === token) return true;
    const record = await store.getVaultPassword(vault);
    if (!record) return !token;
    if (!provided) return false;
    const cacheKey = verifiedKey(vault, provided);
    if (verifiedSecrets.has(cacheKey)) return true;
    const ok = (await checkVaultPassword(req, vault, provided, record)) === "ok";
    if (ok) verifiedSecrets.add(cacheKey);
    return ok;
  }

  // Coupe les flux ouverts : les appareils restés sur l'ancien mot de passe
  // repassent par /info, y lisent `locked` et s'arrêtent au lieu de boucler.
  function dropSubscribers(vault) {
    for (const res of subscribers.get(vault) ?? []) res.end();
  }

  async function replaceVaultPassword(vault, record) {
    await store.setVaultPassword(vault, record);
    forgetVerifiedSecrets(vault);
    dropSubscribers(vault);
  }

  async function readJson(req) {
    try {
      return JSON.parse((await readBody(req)).toString("utf8"));
    } catch {
      return null;
    }
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
      req.on("end", () => resolve(Buffer.concat(chunks)));
      req.on("error", reject);
    });
  }

  // ── back-office ──────────────────────────────────────────────────────────

  // Hash des deux côtés : timingSafeEqual exige des buffers de même longueur.
  function adminAuthed(req) {
    const m = /^Basic (.+)$/.exec(req.headers.authorization ?? "");
    if (!m) return false;
    const password = Buffer.from(m[1], "base64").toString("utf8").split(":").slice(1).join(":");
    return timingSafeEqual(sha256(password), sha256(adminToken));
  }

  async function handleAdmin(req, res) {
    if (!adminAuthed(req)) {
      res.writeHead(401, {
        "WWW-Authenticate": 'Basic realm="Supernote admin", charset="UTF-8"',
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
      });
      res.end("Authentification requise");
      return true;
    }
    const url = new URL(req.url ?? "/admin", "http://admin");
    if (url.pathname === "/admin/reset-password") {
      // Basic Auth est rejouée par le navigateur sur un POST venu d'un autre site :
      // on n'accepte que les formulaires de la page admin elle-même.
      const site = req.headers["sec-fetch-site"];
      const origin = req.headers.origin;
      let sameOrigin = site ? site === "same-origin" : !origin;
      if (!site && origin) {
        try {
          sameOrigin = new URL(origin).host === req.headers.host;
        } catch {
          sameOrigin = false;
        }
      }
      if (req.method !== "POST" || !sameOrigin) {
        res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("Refusé");
        return true;
      }
      const vault = new URLSearchParams((await readBody(req)).toString("utf8")).get("vault");
      if (vault) {
        await replaceVaultPassword(vault, null);
        console.log(`[sync] admin: mot de passe retiré du salon ${vault}`);
      }
      res.writeHead(303, { Location: "/admin", "Cache-Control": "no-store" });
      res.end();
      return true;
    }
    const vaults = await store.listVaults();
    const protectedVaults = new Set(await store.listProtectedVaults());
    // Un salon protégé sans aucune op n'est pas dans l'op-log : sans ça, son mot de passe serait inretirable.
    for (const name of protectedVaults) {
      if (!vaults.some((v) => v.vault === name)) {
        vaults.push({ vault: name, entities: 0, devices: 0, lastActivity: null, bytes: 0 });
      }
    }
    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex",
      "X-Frame-Options": "DENY",
    });
    res.end(renderAdminPage(vaults, protectedVaults, store.kind));
    return true;
  }

  // ── request handler ────────────────────────────────────────────────────────

  async function handle(req, res) {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    const path = url.pathname;
    if (adminToken && (path === "/admin" || path === "/admin/reset-password")) return handleAdmin(req, res);
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
      const vault = url.searchParams.get("vault");
      const body = { enabled: true, requiresToken: !!token, epoch };
      if (vault) body.locked = !(await vaultAuthed(req, url, vault));
      sendJson(res, 200, body);
      return true;
    }

    if (path === "/api/sync/vaults" && req.method === "GET") {
      if (!authed(req, url)) {
        sendJson(res, 401, { error: "unauthorized" });
        return true;
      }
      sendJson(res, 200, { vaults: await store.listProtectedVaults() });
      return true;
    }

    if (path === "/api/sync/join" && req.method === "POST") {
      const parsed = await readJson(req);
      const vault = parsed?.vault;
      const password = parsed?.password;
      if (!vault || typeof vault !== "string" || typeof password !== "string") {
        sendJson(res, 400, { error: "missing vault or password" });
        return true;
      }
      // Le champ secret du client porte SYNC_TOKEN sur les serveurs qui en ont un.
      if (token && password === token) {
        sendJson(res, 200, { ok: true });
        return true;
      }
      let record = await store.getVaultPassword(vault);
      if (!record) {
        if (!authed(req, url)) {
          sendJson(res, 401, { error: "unauthorized" });
          return true;
        }
        if (password.length < MIN_PASSWORD_LENGTH) {
          sendJson(res, 400, { error: "password too short", minLength: MIN_PASSWORD_LENGTH });
          return true;
        }
        if (await store.claimVaultPassword(vault, await hashPassword(password))) {
          sendJson(res, 201, { ok: true, created: true });
          return true;
        }
        // Revendication concurrente perdue : on vérifie contre le mot de passe gagnant.
        record = await store.getVaultPassword(vault);
      }
      const verdict = record ? await checkVaultPassword(req, vault, password, record) : "wrong";
      if (verdict !== "ok") {
        sendJson(res, verdict === "locked" ? 429 : 401, { error: verdict === "locked" ? "too many attempts" : "wrong password" });
        return true;
      }
      sendJson(res, 200, { ok: true });
      return true;
    }

    if (path === "/api/sync/password" && req.method === "POST") {
      const parsed = await readJson(req);
      const vault = parsed?.vault;
      const current = parsed?.current;
      const next = parsed?.next;
      if (!vault || typeof vault !== "string" || typeof current !== "string" || typeof next !== "string") {
        sendJson(res, 400, { error: "missing vault, current or next" });
        return true;
      }
      if (next.length < MIN_PASSWORD_LENGTH) {
        sendJson(res, 400, { error: "password too short", minLength: MIN_PASSWORD_LENGTH });
        return true;
      }
      const record = await store.getVaultPassword(vault);
      if (!record) {
        sendJson(res, 409, { error: "vault not protected" });
        return true;
      }
      const verdict = await checkVaultPassword(req, vault, current, record);
      if (verdict !== "ok") {
        sendJson(res, verdict === "locked" ? 429 : 401, { error: verdict === "locked" ? "too many attempts" : "wrong password" });
        return true;
      }
      await replaceVaultPassword(vault, await hashPassword(next));
      // L'appareil qui change le mot de passe ne doit pas repayer scrypt ni tomber
      // sous un blocage déclenché par un autre appareil resté sur l'ancien.
      verifiedSecrets.add(verifiedKey(vault, next));
      sendJson(res, 200, { ok: true });
      return true;
    }

    if (path === "/api/sync/pull" && req.method === "GET") {
      const vault = url.searchParams.get("vault") ?? "";
      const since = Number(url.searchParams.get("since") ?? "0") || 0;
      if (!vault) {
        sendJson(res, 400, { error: "missing vault" });
        return true;
      }
      if (!(await vaultAuthed(req, url, vault))) {
        sendJson(res, 401, { error: "unauthorized" });
        return true;
      }
      const ops = await store.opsSince(vault, since, REPLAY_BATCH);
      sendJson(res, 200, { headSeq: await store.headSeq(vault), ops });
      return true;
    }

    if (path === "/api/sync/push" && req.method === "POST") {
      const parsed = await readJson(req);
      if (!parsed) {
        sendJson(res, 400, { error: "invalid json" });
        return true;
      }
      const vault = parsed.vault;
      const ops = Array.isArray(parsed.ops) ? parsed.ops : [];
      if (!vault || typeof vault !== "string") {
        sendJson(res, 400, { error: "missing vault" });
        return true;
      }
      if (!(await vaultAuthed(req, url, vault))) {
        sendJson(res, 401, { error: "unauthorized" });
        return true;
      }
      const { stored, acks } = await store.insertMany(vault, ops);
      if (stored.length > 0) await broadcast(vault, stored);
      sendJson(res, 200, { headSeq: await store.headSeq(vault), acks });
      return true;
    }

    // Les ops ne portent que le markdown : sans cette route, une image collée
    // dans une note n'existait que sur l'appareil qui l'avait collée.
    if (path === "/api/sync/blob") {
      const vault = url.searchParams.get("vault") ?? "";
      const blobPath = url.searchParams.get("path") ?? "";
      if (!vault || !blobPath || blobPath.length > 1024) {
        sendJson(res, 400, { error: "missing vault or path" });
        return true;
      }
      if (!(await vaultAuthed(req, url, vault))) {
        sendJson(res, 401, { error: "unauthorized" });
        return true;
      }
      if (req.method === "POST") {
        await store.putBlob(vault, blobPath, await readBody(req));
        sendJson(res, 200, { ok: true });
        return true;
      }
      if (req.method === "GET" || req.method === "HEAD") {
        // ponytail: HEAD relit les octets en base ; une colonne de taille si les images grossissent.
        const bytes = await store.getBlob(vault, blobPath);
        if (!bytes) {
          sendJson(res, 404, { error: "not found" });
          return true;
        }
        res.writeHead(200, {
          "Content-Type": "application/octet-stream",
          "Content-Length": bytes.length,
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "no-store",
        });
        res.end(req.method === "HEAD" ? undefined : bytes);
        return true;
      }
    }

    if (path === "/api/sync/stream" && req.method === "GET") {
      const vault = url.searchParams.get("vault") ?? "";
      const since = Number(url.searchParams.get("since") ?? "0") || 0;
      if (!vault) {
        sendJson(res, 400, { error: "missing vault" });
        return true;
      }
      if (!(await vaultAuthed(req, url, vault))) {
        sendJson(res, 401, { error: "unauthorized" });
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

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function formatBytes(n) {
  if (n < 1024) return `${n} o`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} Ko`;
  return `${(n / (1024 * 1024)).toFixed(1)} Mo`;
}

const formatDate = (ms) =>
  new Date(ms).toLocaleString("fr-FR", {
    timeZone: "Europe/Paris",
    dateStyle: "short",
    timeStyle: "short",
  });

function renderAdminPage(vaults, protectedVaults, engine) {
  const rows = vaults
    .map(
      (v) => `<tr>
        <td>${escapeHtml(v.vault)}</td>
        <td class="n">${v.entities}</td>
        <td class="n">${v.devices}</td>
        <td>${v.lastActivity ? formatDate(v.lastActivity) : "—"}</td>
        <td class="n">${formatBytes(v.bytes)}</td>
        <td>${
          protectedVaults.has(v.vault)
            ? `<form method="post" action="/admin/reset-password"
                onsubmit="return confirm('Retirer ce mot de passe ? Le salon redevient ouvert à quiconque connaît son nom.')">
                <input type="hidden" name="vault" value="${escapeHtml(v.vault)}">
                <button type="submit">Retirer</button>
              </form>`
            : "—"
        }</td>
      </tr>`,
    )
    .join("");
  const body =
    vaults.length === 0
      ? `<p>Aucun espace synchronisé.</p>`
      : `<div class="wrap"><table>
          <thead><tr>
            <th>Espace</th><th class="n">Entités</th><th class="n">Appareils</th>
            <th>Dernière activité</th><th class="n">Volume</th><th>Mot de passe</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table></div>`;
  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Supernote · Admin</title>
<style>
  :root { color-scheme: light dark; font: 14px/1.5 system-ui, sans-serif; }
  body { max-width: 960px; margin: 0 auto; padding: 24px 16px; }
  h1 { font-size: 18px; margin: 0; }
  .meta { margin: 4px 0 20px; opacity: 0.65; }
  .wrap { overflow-x: auto; }
  table { border-collapse: collapse; width: 100%; }
  th, td { padding: 8px 12px; text-align: left; white-space: nowrap;
    border-bottom: 1px solid color-mix(in srgb, currentColor 15%, transparent); }
  th { font-weight: 600; opacity: 0.7; }
  .n { text-align: right; font-variant-numeric: tabular-nums; }
  form { margin: 0; }
  button { font: inherit; padding: 6px 12px; min-height: 32px; cursor: pointer; }
</style>
</head>
<body>
<h1>Espaces synchronisés</h1>
<p class="meta">${vaults.length} espace(s) · base ${escapeHtml(engine)} · ${formatDate(Date.now())}</p>
${body}
</body>
</html>`;
}
