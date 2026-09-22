/**
 * share-backend — partage par lien v2 (spec 2026-09-22-partage-liens-collab).
 *
 * Monté par `server.mjs` et le middleware de dev seulement si `DATABASE_URL`
 * est défini. Propriétaire : en-tête `x-share-owner` (clé de 32 octets dont
 * seul le SHA-256 est stocké). Invité : jeton HMAC obtenu par `unlock`, en
 * `Authorization: Bearer`, revérifié à chaque appel contre l'état du lien.
 */

import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { createShareStore } from "./share-store.mjs";
import { createPasswordChecker, hashPassword } from "./password.mjs";

const MAX_JSON_BYTES = 4 * 1024 * 1024;
const MAX_BLOB_BYTES = 10 * 1024 * 1024;
const MAX_DOC_BYTES = 5 * 1024 * 1024;
const TOKEN_TTL_MS = 12 * 60 * 60 * 1000;
const MIN_PASSWORD_LENGTH = 6;
const SWEEP_MS = 60_000;

const IMAGE_TYPES = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
  webp: "image/webp", avif: "image/avif", svg: "image/svg+xml",
};

const newId = (bytes) => randomBytes(bytes).toString("base64url");
const sha256hex = (s) => createHash("sha256").update(s).digest("hex");

function sameString(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

function linkState(link) {
  if (!link) return "missing";
  if (link.revokedAt) return "revoked";
  if (link.expiresAt != null && link.expiresAt <= Date.now()) return "expired";
  return "ok";
}

function publicLink(link) {
  return {
    slug: link.slug,
    mode: link.mode,
    hasPassword: !!link.passwordHash,
    expiresAt: link.expiresAt,
    label: link.label,
    createdAt: link.createdAt,
    revokedAt: link.revokedAt,
  };
}

function cleanSnapshot(raw) {
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.messages) || raw.messages.length > 200) return null;
  const str = (v, max) => (typeof v === "string" ? v.slice(0, max) : "");
  return {
    subject: str(raw.subject, 500),
    messages: raw.messages.map((m) => ({
      from: str(m?.from, 500),
      to: str(m?.to, 2000),
      date: str(m?.date, 40),
      bodyText: str(m?.bodyText, 200_000),
    })),
  };
}

// `null` = retirer ; `undefined` = ne pas toucher ; sinon un instant futur.
function parseExpiry(v) {
  if (v === undefined) return undefined;
  if (v === null) return null;
  return typeof v === "number" && Number.isFinite(v) && v > Date.now() ? v : NaN;
}

function escapeHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function legacyPage({ title, html, updatedAt }) {
  const safeTitle = escapeHtml(title || "Note partagée");
  const date = new Date(updatedAt).toLocaleString("fr-FR", { dateStyle: "long", timeStyle: "short" });
  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${safeTitle}</title>
<style>
  :root { color-scheme: light dark; --fg: #1a1a1a; --muted: #6b6b6b; --bg: #fff; --border: #e5e5e5; --code-bg: #f4f4f5; }
  @media (prefers-color-scheme: dark) { :root { --fg: #e8e8e8; --muted: #9a9a9a; --bg: #16161a; --border: #2a2a30; --code-bg: #1e1e24; } }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--fg); font: 16px/1.65 -apple-system, "Inter", ui-sans-serif, system-ui, sans-serif; }
  main { max-width: 720px; margin: 0 auto; padding: 56px 24px 80px; }
  h1.sn-share-title { font-size: 28px; font-weight: 700; margin: 0 0 4px; }
  .sn-share-meta { color: var(--muted); font-size: 13px; margin: 0 0 40px; }
  img { max-width: 100%; border-radius: 6px; }
  pre { background: var(--code-bg); padding: 12px 14px; border-radius: 8px; overflow-x: auto; }
  table { border-collapse: collapse; width: 100%; margin: 1em 0; font-size: 0.92em; }
  th, td { border: 1px solid var(--border); padding: 6px 10px; text-align: left; }
</style>
</head>
<body>
<main>
  <h1 class="sn-share-title">${safeTitle}</h1>
  <p class="sn-share-meta">Mis à jour le ${escapeHtml(date)}</p>
  <article>${html}</article>
</main>
</body>
</html>`;
}

export async function createShareBackend() {
  if (!process.env.DATABASE_URL) return { enabled: false, handle: async () => false };

  const store = await createShareStore();
  const checkPassword = createPasswordChecker();
  const secret = process.env.SHARE_SECRET || (await store.ensureMeta("signing-secret", () => newId(32)));
  const hmac = (payload) => createHmac("sha256", secret).update(payload).digest("base64url");
  const passwordVersion = (link) => createHash("sha256").update(link.passwordHash ?? "").digest("base64url").slice(0, 8);

  console.log(`[share] partage par lien ACTIF (${store.kind} : ${store.label})`);

  function signToken(link) {
    const exp = Math.min(link.expiresAt ?? Number.MAX_SAFE_INTEGER, Date.now() + TOKEN_TTL_MS);
    const payload = `${link.slug}.${exp}.${passwordVersion(link)}`;
    return `${payload}.${hmac(payload)}`;
  }

  async function linkFromToken(token) {
    const parts = String(token ?? "").split(".");
    if (parts.length !== 4) return null;
    const [slug, exp, pv, sig] = parts;
    if (!sameString(sig, hmac(`${slug}.${exp}.${pv}`)) || Number(exp) <= Date.now()) return null;
    const link = await store.getLink(slug);
    if (linkState(link) !== "ok" || passwordVersion(link) !== pv) return null;
    return link;
  }

  const ownerMatches = (key, resource) => !!key && !!resource && sameString(sha256hex(key), resource.ownerKeyHash);

  // Branché en Task 4 (collab-server.mjs) ; sans lui, rien à couper.
  let collab = { closeLink() {}, closeResource() {}, sweep: async () => {} };

  function send(res, status, body, headers = {}) {
    res.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...headers,
    });
    res.end(JSON.stringify(body));
  }

  function readBody(req, limit) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      let size = 0;
      req.on("data", (c) => {
        size += c.length;
        if (size > limit) {
          reject(Object.assign(new Error("payload too large"), { status: 413 }));
          req.destroy();
          return;
        }
        chunks.push(c);
      });
      req.on("end", () => resolve(Buffer.concat(chunks)));
      req.on("error", reject);
    });
  }

  async function readJson(req) {
    const buf = await readBody(req, MAX_JSON_BYTES);
    try {
      return buf.length ? JSON.parse(buf.toString("utf8")) : {};
    } catch {
      throw Object.assign(new Error("invalid json"), { status: 400 });
    }
  }

  async function ownedResource(req, id) {
    const resource = await store.getResource(id);
    if (!resource) throw Object.assign(new Error("not found"), { status: 404 });
    if (!ownerMatches(req.headers["x-share-owner"], resource)) throw Object.assign(new Error("forbidden"), { status: 403 });
    return resource;
  }

  async function ownedLink(req, slug) {
    const link = await store.getLink(slug);
    if (!link) throw Object.assign(new Error("not found"), { status: 404 });
    const resource = await ownedResource(req, link.resourceId);
    return { link, resource };
  }

  async function accessLink(req, slug) {
    const bearer = String(req.headers.authorization ?? "").replace(/^Bearer /, "");
    const link = await linkFromToken(bearer);
    if (!link || link.slug !== slug) throw Object.assign(new Error("unauthorized"), { status: 401 });
    return link;
  }

  async function passwordHashFrom(value) {
    if (value == null || value === "") return null;
    if (typeof value !== "string" || value.length < MIN_PASSWORD_LENGTH || value.length > 200) {
      throw Object.assign(new Error(`password must be ${MIN_PASSWORD_LENGTH}-200 chars`), { status: 400 });
    }
    return hashPassword(value);
  }

  async function authenticateCollab(resourceId, token) {
    const resource = await store.getResource(resourceId);
    if (!resource || resource.kind !== "note") throw new Error("unknown document");
    if (String(token).startsWith("owner:")) {
      if (ownerMatches(String(token).slice(6), resource)) return { slug: null, readOnly: false };
      throw new Error("forbidden");
    }
    const link = await linkFromToken(token);
    if (!link || link.resourceId !== resourceId) throw new Error("forbidden");
    return { slug: link.slug, readOnly: link.mode !== "write" };
  }

  const routes = [
    ["GET", /^\/api\/share\/_info$/, async (_req, res) => send(res, 200, { enabled: true })],

    ["POST", /^\/api\/share\/resources$/, async (req, res) => {
      const body = await readJson(req);
      const kind = body.kind === "email" ? "email" : body.kind === "note" ? "note" : null;
      if (!kind) return send(res, 400, { error: "kind must be note or email" });
      const snapshot = kind === "email" ? cleanSnapshot(body.snapshot) : null;
      if (kind === "email" && !snapshot) return send(res, 400, { error: "invalid snapshot" });
      const id = newId(16);
      const ownerKey = newId(32);
      const title = typeof body.title === "string" ? body.title.slice(0, 300) : "";
      await store.createResource({ id, kind, ownerKeyHash: sha256hex(ownerKey), title, snapshot });
      send(res, 201, { id, ownerKey });
    }],

    ["PATCH", /^\/api\/share\/resources\/([\w-]+)$/, async (req, res, [id]) => {
      await ownedResource(req, id);
      const body = await readJson(req);
      if (typeof body.title !== "string") return send(res, 400, { error: "missing title" });
      await store.renameResource(id, body.title.slice(0, 300));
      send(res, 200, { ok: true });
    }],

    ["DELETE", /^\/api\/share\/resources\/([\w-]+)$/, async (req, res, [id]) => {
      await ownedResource(req, id);
      await store.deleteResource(id);
      collab.closeResource(id);
      send(res, 200, { ok: true });
    }],

    ["PUT", /^\/api\/share\/resources\/([\w-]+)\/doc$/, async (req, res, [id]) => {
      const resource = await ownedResource(req, id);
      if (resource.kind !== "note") return send(res, 400, { error: "not a note" });
      const bytes = await readBody(req, MAX_DOC_BYTES);
      const seeded = await store.seedDoc(id, bytes);
      send(res, seeded ? 201 : 409, seeded ? { ok: true } : { error: "already seeded" });
    }],

    ["GET", /^\/api\/share\/resources\/([\w-]+)\/links$/, async (req, res, [id]) => {
      await ownedResource(req, id);
      send(res, 200, { links: (await store.listLinks(id)).map(publicLink) });
    }],

    ["POST", /^\/api\/share\/resources\/([\w-]+)\/links$/, async (req, res, [id]) => {
      const resource = await ownedResource(req, id);
      const body = await readJson(req);
      const mode = body.mode === "write" ? "write" : "read";
      if (mode === "write" && resource.kind !== "note") return send(res, 400, { error: "write links are notes-only" });
      const expiresAt = parseExpiry(body.expiresAt ?? null);
      if (Number.isNaN(expiresAt)) return send(res, 400, { error: "expiresAt must be in the future" });
      const link = {
        slug: newId(12),
        resourceId: id,
        mode,
        passwordHash: await passwordHashFrom(body.password),
        expiresAt,
        label: typeof body.label === "string" && body.label.trim() ? body.label.trim().slice(0, 80) : null,
      };
      await store.createLink(link);
      send(res, 201, { link: publicLink(await store.getLink(link.slug)) });
    }],

    ["PUT", /^\/api\/share\/resources\/([\w-]+)\/blob$/, async (req, res, [id], url) => {
      const resource = await ownedResource(req, id);
      const path = url.searchParams.get("path") ?? "";
      if (resource.kind !== "note" || !path || path.length > 500) return send(res, 400, { error: "invalid path" });
      await store.putBlob(id, path, await readBody(req, MAX_BLOB_BYTES));
      send(res, 200, { ok: true });
    }],

    ["PATCH", /^\/api\/share\/links\/([\w-]+)$/, async (req, res, [slug]) => {
      const { link } = await ownedLink(req, slug);
      const body = await readJson(req);
      const patch = {};
      if ("password" in body) patch.passwordHash = await passwordHashFrom(body.password);
      if ("expiresAt" in body) {
        const expiresAt = parseExpiry(body.expiresAt);
        if (Number.isNaN(expiresAt)) return send(res, 400, { error: "expiresAt must be in the future" });
        patch.expiresAt = expiresAt;
      }
      if ("label" in body) patch.label = typeof body.label === "string" && body.label.trim() ? body.label.trim().slice(0, 80) : null;
      await store.updateLink(slug, patch);
      if ("passwordHash" in patch || "expiresAt" in patch) collab.closeLink(link.resourceId, slug);
      send(res, 200, { link: publicLink(await store.getLink(slug)) });
    }],

    ["DELETE", /^\/api\/share\/links\/([\w-]+)$/, async (req, res, [slug]) => {
      const { link } = await ownedLink(req, slug);
      await store.revokeLink(slug);
      collab.closeLink(link.resourceId, slug);
      send(res, 200, { ok: true });
    }],

    ["GET", /^\/api\/share\/links\/([\w-]+)\/meta$/, async (_req, res, [slug]) => {
      const link = await store.getLink(slug);
      const state = linkState(link);
      if (state === "missing") return send(res, 404, { reason: "missing" });
      if (state !== "ok") return send(res, 410, { reason: state });
      const resource = await store.getResource(link.resourceId);
      if (!resource) return send(res, 404, { reason: "missing" });
      send(res, 200, { kind: resource.kind, mode: link.mode, title: resource.title, needsPassword: !!link.passwordHash });
    }],

    ["POST", /^\/api\/share\/links\/([\w-]+)\/unlock$/, async (req, res, [slug]) => {
      const link = await store.getLink(slug);
      const state = linkState(link);
      if (state === "missing") return send(res, 404, { reason: "missing" });
      if (state !== "ok") return send(res, 410, { reason: state });
      if (link.passwordHash) {
        const body = await readJson(req);
        const provided = typeof body.password === "string" ? body.password : "";
        const verdict = provided ? await checkPassword(`share:${slug}`, req, provided, link.passwordHash) : "wrong";
        if (verdict === "locked") return send(res, 429, { reason: "locked" });
        if (verdict !== "ok") return send(res, 401, { reason: "wrong" });
      }
      const resource = await store.getResource(link.resourceId);
      if (!resource) return send(res, 404, { reason: "missing" });
      send(res, 200, { accessToken: signToken(link), resourceId: resource.id, kind: resource.kind, mode: link.mode });
    }],

    ["GET", /^\/api\/share\/links\/([\w-]+)\/content$/, async (req, res, [slug]) => {
      const link = await accessLink(req, slug);
      const resource = await store.getResource(link.resourceId);
      if (!resource || resource.kind !== "email") return send(res, 404, { reason: "missing" });
      send(res, 200, { title: resource.title, snapshot: resource.snapshot });
    }],

    ["GET", /^\/api\/share\/links\/([\w-]+)\/blob$/, async (req, res, [slug], url) => {
      const link = await accessLink(req, slug);
      const path = url.searchParams.get("path") ?? "";
      const bytes = path ? await store.getBlob(link.resourceId, path) : null;
      if (!bytes) return send(res, 404, { reason: "missing" });
      const ext = path.split(".").pop()?.toLowerCase() ?? "";
      res.writeHead(200, {
        "Content-Type": IMAGE_TYPES[ext] ?? "application/octet-stream",
        "Cache-Control": "private, max-age=300",
        "X-Content-Type-Options": "nosniff",
        // Un SVG ouvert directement ne doit rien exécuter sur l'origine de l'app.
        "Content-Security-Policy": "sandbox; default-src 'none'; style-src 'unsafe-inline'",
      });
      res.end(bytes);
    }],
  ];

  async function handle(req, res) {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    const path = url.pathname;

    if (req.method === "GET" && path.startsWith("/s/")) {
      const legacy = await store.legacyBySlug(path.slice(3));
      if (!legacy) return false;
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-cache",
        "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; img-src data: https: http:; frame-ancestors 'none'",
        "X-Frame-Options": "DENY",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "strict-origin-when-cross-origin",
      });
      res.end(legacyPage(legacy));
      return true;
    }

    if (!path.startsWith("/api/share/")) return false;
    for (const [method, re, fn] of routes) {
      const match = req.method === method ? path.match(re) : null;
      if (!match) continue;
      try {
        await fn(req, res, match.slice(1), url);
      } catch (err) {
        const status = err?.status ?? 500;
        if (status === 500) console.error("[share]", err);
        if (!res.headersSent) send(res, status, { error: status === 500 ? "internal error" : err.message });
      }
      return true;
    }
    send(res, 404, { error: "not found" });
    return true;
  }

  return {
    enabled: true,
    handle,
    // Task 4 remplace ces deux membres.
    attachCollab: (c) => {
      collab = c;
      setInterval(() => void collab.sweep(async (slug) => linkState(await store.getLink(slug)) === "ok"), SWEEP_MS).unref();
    },
    authenticateCollab,
    store,
  };
}
