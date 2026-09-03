/**
 * share-backend — public read-only note shares.
 *
 * Mounted by `server.mjs` under `/api/share/*` (write/status endpoints) and
 * `/s/*` (the public page) only when `DATABASE_URL` is set — mirrors the
 * optional `sync-backend.mjs`/`coda-backend.mjs` mounts, same "zero surface
 * when unconfigured" guarantee.
 *
 * The client renders the note to HTML itself (BlockNote `blocksToHTMLLossy`,
 * enriched with live formula values and base tables — see
 * `src/lib/share/exportNoteHtml.ts`) and PUSHes that markup here. The server
 * never trusts it as-is: every publish re-sanitizes with DOMPurify running
 * over a jsdom window (same belt-and-suspenders approach as the DocxViewer
 * fix — untrusted HTML in, allowlisted HTML out) before it ever touches the
 * store or a response. `jsdom`/`dompurify` are lazy-imported here, so a
 * plain static deployment (no `DATABASE_URL`) never pulls them in.
 *
 * Auth: publishing/unpublishing/reading status reuses the same `SYNC_TOKEN`
 * shared secret as the sync backend (when set) — one secret to configure,
 * not two. `GET /s/:slug` is deliberately open: that's the public link.
 *
 * Endpoints:
 *   GET    /api/share/_info        → { enabled, requiresToken }
 *   GET    /api/share/:entityId    → { published, slug?, updatedAt? }
 *   PUT    /api/share/:entityId    { title, html } → { slug, updatedAt }
 *   DELETE /api/share/:entityId    → { ok }
 *   GET    /s/:slug                → public HTML page (no auth)
 */

import { createShareStore } from "./share-store.mjs";

const MAX_BODY_BYTES = 8 * 1024 * 1024;

const ALLOWED_TAGS = [
  "p", "br", "hr", "strong", "em", "u", "s", "del", "mark", "sub", "sup",
  "code", "pre",
  "h1", "h2", "h3", "h4", "h5", "h6",
  "ul", "ol", "li",
  "blockquote",
  "table", "thead", "tbody", "tr", "th", "td",
  "a", "img", "span", "div", "figure", "figcaption",
];
const ALLOWED_ATTR = [
  "href", "src", "alt", "title", "class", "style", "colspan", "rowspan",
  "data-formula", "data-output-kind", "data-display", "data-base-id", "data-view-id",
];

export async function createShareBackend() {
  const enabled = !!process.env.DATABASE_URL;
  if (!enabled) {
    return { enabled: false, handle: () => false };
  }

  const token = process.env.SYNC_TOKEN || "";
  const store = await createShareStore();

  // jsdom + DOMPurify only ever load when a share is actually published —
  // most deployments with DATABASE_URL will use it for cloud-vault sync and
  // never touch sharing at all.
  let purify;
  async function sanitize(html) {
    if (!purify) {
      const [{ JSDOM }, createDOMPurify] = await Promise.all([
        import("jsdom"),
        import("dompurify").then((m) => m.default),
      ]);
      const { window } = new JSDOM("");
      purify = createDOMPurify(window);
    }
    return purify.sanitize(html, {
      ALLOWED_TAGS,
      ALLOWED_ATTR,
      ALLOW_DATA_ATTR: false,
    });
  }

  console.log(`[share] public note sharing ENABLED (${store.kind} store at ${store.label})`);

  function authed(req, url) {
    if (!token) return true;
    const provided = req.headers["x-sync-token"] || url.searchParams.get("token");
    return provided === token;
  }

  function sendJson(res, status, body) {
    res.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "content-type, x-sync-token",
      "Access-Control-Allow-Methods": "GET, PUT, DELETE, OPTIONS",
      "Cache-Control": "no-store",
    });
    res.end(JSON.stringify(body));
  }

  function readBody(req) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      let size = 0;
      req.on("data", (c) => {
        size += c.length;
        if (size > MAX_BODY_BYTES) {
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

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function publicPage({ title, html, updatedAt }) {
    const safeTitle = escapeHtml(title || "Note partagée");
    const date = new Date(updatedAt).toLocaleString("fr-FR", {
      dateStyle: "long",
      timeStyle: "short",
    });
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
  h1, h2, h3, h4 { line-height: 1.3; margin: 1.6em 0 0.5em; }
  p { margin: 0.9em 0; }
  img { max-width: 100%; border-radius: 6px; }
  pre { background: var(--code-bg); padding: 12px 14px; border-radius: 8px; overflow-x: auto; }
  code { background: var(--code-bg); padding: 0.1em 0.35em; border-radius: 4px; font-size: 0.9em; }
  pre code { background: none; padding: 0; }
  blockquote { border-left: 3px solid var(--border); margin: 1em 0; padding: 0.2em 1em; color: var(--muted); }
  table { border-collapse: collapse; width: 100%; margin: 1em 0; font-size: 0.92em; }
  th, td { border: 1px solid var(--border); padding: 6px 10px; text-align: left; }
  a { color: inherit; }
  footer.sn-share-footer { margin-top: 64px; padding-top: 16px; border-top: 1px solid var(--border); color: var(--muted); font-size: 12px; }
</style>
</head>
<body>
<main>
  <h1 class="sn-share-title">${safeTitle}</h1>
  <p class="sn-share-meta">Mis à jour le ${escapeHtml(date)}</p>
  <article>${html}</article>
  <footer class="sn-share-footer">Partagé en lecture seule depuis Supernote.</footer>
</main>
</body>
</html>`;
  }

  async function handle(req, res) {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    const path = url.pathname;

    // Public page — not under /api, no auth.
    if (path.startsWith("/s/") && req.method === "GET") {
      const slug = path.slice(3);
      if (!slug) return false;
      const share = await store.getBySlug(slug);
      if (!share) {
        res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
        res.end("<!doctype html><title>Introuvable</title><p>Ce lien de partage n'existe pas ou a été retiré.</p>");
        return true;
      }
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-cache",
        "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; img-src data: https: http:; frame-ancestors 'none'",
        "X-Frame-Options": "DENY",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "strict-origin-when-cross-origin",
        "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
      });
      res.end(publicPage(share));
      return true;
    }

    if (!path.startsWith("/api/share/")) return false;

    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "content-type, x-sync-token",
        "Access-Control-Allow-Methods": "GET, PUT, DELETE, OPTIONS",
      });
      res.end();
      return true;
    }

    const sub = path.slice("/api/share/".length);

    if (sub === "_info" && req.method === "GET") {
      sendJson(res, 200, { enabled: true, requiresToken: !!token });
      return true;
    }

    if (!authed(req, url)) {
      sendJson(res, 401, { error: "unauthorized" });
      return true;
    }

    const entityId = decodeURIComponent(sub);
    if (!entityId) {
      sendJson(res, 400, { error: "missing entityId" });
      return true;
    }

    if (req.method === "GET") {
      const share = await store.get(entityId);
      if (!share) {
        sendJson(res, 200, { published: false });
        return true;
      }
      sendJson(res, 200, { published: true, slug: share.slug, updatedAt: share.updatedAt });
      return true;
    }

    if (req.method === "PUT") {
      let parsed;
      try {
        parsed = JSON.parse(await readBody(req));
      } catch {
        sendJson(res, 400, { error: "invalid json" });
        return true;
      }
      const title = typeof parsed?.title === "string" ? parsed.title.slice(0, 300) : "";
      const rawHtml = typeof parsed?.html === "string" ? parsed.html : "";
      if (!rawHtml.trim()) {
        sendJson(res, 400, { error: "missing html" });
        return true;
      }
      let html;
      try {
        html = await sanitize(rawHtml);
      } catch (err) {
        console.error("[share] sanitize failed:", err);
        sendJson(res, 500, { error: "sanitize failed" });
        return true;
      }
      const { slug, updatedAt } = await store.upsert(entityId, { title, html });
      sendJson(res, 200, { slug, updatedAt });
      return true;
    }

    if (req.method === "DELETE") {
      await store.remove(entityId);
      sendJson(res, 200, { ok: true });
      return true;
    }

    sendJson(res, 405, { error: "method not allowed" });
    return true;
  }

  return { enabled: true, handle };
}
