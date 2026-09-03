/**
 * Production static server for the Supernote PWA (client-only Vite SPA).
 *
 * Stays dependency-free for the static-serving path — runs on the Node runtime
 * always present on Scalingo, so it survives any devDependency pruning
 * (vite/turbo are build-time only). Serves the prebuilt `dist/` with
 * history-API fallback to index.html for client-side routes, and the correct
 * MIME types for the wasm / module / font assets the app loads at runtime.
 *
 * Optional realtime online sync: when `DATABASE_URL` is set, the server also
 * mounts the SSE/POST sync backend under `/api/sync/*` (see `sync-backend.mjs`).
 * That path lazily pulls in `better-sqlite3`; without `DATABASE_URL` it's never
 * imported, so the default deployment keeps its zero-dependency guarantee.
 */
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { join, extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const DIST = join(fileURLToPath(new URL(".", import.meta.url)), "dist");
const PORT = Number(process.env.PORT) || 3100;
const HOST = "0.0.0.0";

// Optional realtime online-sync backend. Built only when a database is
// configured; a load failure must never take down static serving.
let syncBackend = { enabled: false, handle: () => false };
if (process.env.DATABASE_URL) {
  try {
    const { createSyncBackend } = await import("./sync-backend.mjs");
    syncBackend = await createSyncBackend();
  } catch (err) {
    console.error("[server] online sync backend failed to load (static serving continues):", err);
  }
}

// Optional read-only Coda importer proxy. Mounted only when CODA_API_TOKEN is
// set; keeps the token server-side and bypasses Coda's lack of CORS. A load
// failure must never take down static serving.
let codaBackend = { enabled: false, handle: () => false };
if (process.env.CODA_API_TOKEN) {
  try {
    const { createCodaBackend } = await import("./coda-backend.mjs");
    codaBackend = await createCodaBackend();
  } catch (err) {
    console.error("[server] coda backend failed to load (static serving continues):", err);
  }
}

// Optional public note sharing. Mounted only when DATABASE_URL is set (same
// gate as the sync backend — it needs somewhere durable to keep published
// snapshots). A load failure must never take down static serving.
let shareBackend = { enabled: false, handle: () => false };
if (process.env.DATABASE_URL) {
  try {
    const { createShareBackend } = await import("./share-backend.mjs");
    shareBackend = await createShareBackend();
  } catch (err) {
    console.error("[server] share backend failed to load (static serving continues):", err);
  }
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".wasm": "application/wasm",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".map": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".webmanifest": "application/manifest+json",
};

async function tryFile(absPath) {
  try {
    const s = await stat(absPath);
    if (s.isFile()) return absPath;
  } catch {
    /* not found */
  }
  return null;
}

// En-têtes de sécurité appliqués à TOUTES les réponses. Non-cassants : nosniff,
// anti-framing, referrer restreint, HSTS (ignoré hors HTTPS, donc sans effet en
// dev local, actif derrière le TLS Scalingo).
const GLOBAL_SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "SAMEORIGIN",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
};

// CSP en mode Report-Only : deuxième couche anti-XSS (le corps des emails est
// déjà sanitizé DOMPurify) SANS risque de casser la prod — le navigateur signale
// les violations mais ne bloque rien. Passer en `Content-Security-Policy`
// (enforce) seulement après avoir vérifié l'absence de violation légitime en
// prod (sql.js-wasm, Google Identity Services, embeds Sheets, Unsplash…).
const CSP_DIRECTIVES = [
  "default-src 'self'",
  // 'wasm-unsafe-eval' : sql.js/sqlite-wasm. GIS charge des scripts Google.
  "script-src 'self' 'wasm-unsafe-eval' https://accounts.google.com https://apis.google.com",
  // Tailwind/HeroUI + styles inline (ErrorBoundary, bannières) → 'unsafe-inline'.
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  // Gmail/Drive/OAuth + Unsplash + backend de sync same-origin.
  "connect-src 'self' blob: https://accounts.google.com https://oauth2.googleapis.com https://www.googleapis.com https://gmail.googleapis.com https://api.unsplash.com https://images.unsplash.com",
  // Embed Google Sheets + iframe GIS.
  "frame-src 'self' https://docs.google.com https://accounts.google.com",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'self'",
].join("; ");

function send(res, status, body, headers = {}) {
  res.writeHead(status, { ...GLOBAL_SECURITY_HEADERS, ...headers });
  res.end(body);
}

const server = createServer(async (req, res) => {
  try {
    // Realtime sync routes take precedence over static serving.
    if (syncBackend.enabled && (req.url ?? "").startsWith("/api/sync/")) {
      const handled = await syncBackend.handle(req, res);
      if (handled) return;
    }

    // Read-only Coda importer proxy.
    if (codaBackend.enabled && (req.url ?? "").startsWith("/api/coda/")) {
      const handled = await codaBackend.handle(req, res);
      if (handled) return;
    }

    // Public note sharing: /api/share/* (auth'd read/write) + /s/* (public page).
    if (shareBackend.enabled) {
      const u = req.url ?? "";
      if (u.startsWith("/api/share/") || u.startsWith("/s/")) {
        const handled = await shareBackend.handle(req, res);
        if (handled) return;
      }
    }

    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    let pathname = decodeURIComponent(url.pathname);
    if (pathname.endsWith("/")) pathname += "index.html";

    // Resolve against DIST and reject path traversal.
    const candidate = resolve(DIST, "." + pathname);
    if (candidate !== DIST && !candidate.startsWith(DIST + sep)) {
      return send(res, 403, "Forbidden");
    }

    let filePath = await tryFile(candidate);

    // History-API fallback: unknown, extension-less routes serve the SPA shell.
    if (!filePath && !extname(pathname)) {
      filePath = await tryFile(join(DIST, "index.html"));
    }
    if (!filePath) return send(res, 404, "Not found");

    const ext = extname(filePath).toLowerCase();
    const type = MIME[ext] ?? "application/octet-stream";
    const data = await readFile(filePath);

    // Hashed build assets are immutable; the SPA shell must never be cached
    // stale or routing breaks after a deploy.
    const isHtml = ext === ".html";
    const cacheControl = isHtml
      ? "no-cache"
      : "public, max-age=31536000, immutable";

    send(res, 200, data, {
      "Content-Type": type,
      "Cache-Control": cacheControl,
      // CSP seulement sur le document HTML (inutile sur les assets).
      ...(isHtml ? { "Content-Security-Policy-Report-Only": CSP_DIRECTIVES } : {}),
    });
  } catch (err) {
    send(res, 500, "Internal server error");
    console.error("[server] request failed:", err);
  }
});

server.listen(PORT, HOST, () => {
  console.log(`[server] serving ${DIST} on http://${HOST}:${PORT}`);
});
