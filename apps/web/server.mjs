/**
 * Production static server for the Supernote PWA (client-only Vite SPA).
 *
 * Zero dependencies — runs on the Node runtime always present on Scalingo,
 * so it survives any devDependency pruning (vite/turbo are build-time only).
 * Serves the prebuilt `dist/` with history-API fallback to index.html for
 * client-side routes, and the correct MIME types for the wasm / module /
 * font assets the app loads at runtime.
 */
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { join, extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const DIST = join(fileURLToPath(new URL(".", import.meta.url)), "dist");
const PORT = Number(process.env.PORT) || 3100;
const HOST = "0.0.0.0";

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

function send(res, status, body, headers = {}) {
  res.writeHead(status, headers);
  res.end(body);
}

const server = createServer(async (req, res) => {
  try {
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

    send(res, 200, data, { "Content-Type": type, "Cache-Control": cacheControl });
  } catch (err) {
    send(res, 500, "Internal server error");
    console.error("[server] request failed:", err);
  }
});

server.listen(PORT, HOST, () => {
  console.log(`[server] serving ${DIST} on http://${HOST}:${PORT}`);
});
