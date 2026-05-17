/**
 * Supernote Service Worker — offline-first app shell cache.
 *
 * Strategy:
 *   - Install: pre-cache the HTML shell + critical assets
 *   - Activate: delete old caches
 *   - Fetch: cache-first for static assets, network-first for navigation
 *
 * This is a plain JS file placed in public/ so Next.js serves it at /sw.js.
 * It must NOT be transpiled by webpack (hence not in src/).
 */

const CACHE_VERSION = "supernote-v12-minimal-headers";

// We must rebuild Responses before caching: Vite preview (and several CDNs)
// expose `Content-Encoding: gzip` to the SW even though the body has already
// been decompressed by the browser. Chrome accepts this for `fetch()` but
// rejects it for ESM `import()` with the cryptic "Failed to fetch dynamically
// imported module". We also drop other hop-by-hop / cache-validating headers
// that can confuse Chrome's module loader (no-cache forces a revalidation
// the offline page can't satisfy; vary: Origin tightens match strictness).
// Only the content-type is preserved so MIME sniffing keeps working.
async function cacheCleanResponse(cache, request, response) {
  if (!response.ok || response.status !== 200) return;
  const body = await response.arrayBuffer();
  const contentType = response.headers.get("content-type");
  const headers = contentType ? { "Content-Type": contentType } : undefined;
  await cache.put(
    request,
    new Response(body, {
      status: 200,
      statusText: "OK",
      headers,
    }),
  );
}

// `self.__WB_MANIFEST` is replaced at build time by vite-plugin-pwa with the
// list of every hashed asset Vite emitted (JS chunks, CSS, fonts, wasm, …).
// In dev the property is undefined — we register no SW in dev anyway, but
// guard against it so this file stays valid JavaScript when served raw.
const PRECACHE_ENTRIES = self.__WB_MANIFEST || [];
const PRECACHE_URLS = (() => {
  const urls = new Set(["/", "/manifest.json"]);
  for (const entry of PRECACHE_ENTRIES) {
    urls.add(typeof entry === "string" ? entry : entry.url);
  }
  return Array.from(urls);
})();

// ── Install ───────────────────────────────────────────────────────────────────

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_VERSION);
      // Fetch + cache each entry through `cacheCleanResponse` so the stored
      // body has no stale `content-encoding` header. `cache.add()` would reuse
      // the raw Response and break ESM `import()` later.
      await Promise.allSettled(
        PRECACHE_URLS.map(async (url) => {
          const request = new Request(url, { cache: "reload" });
          const response = await fetch(request);
          await cacheCleanResponse(cache, request, response);
        }),
      );
      await self.skipWaiting();
    })(),
  );
});

// ── Activate ──────────────────────────────────────────────────────────────────

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== CACHE_VERSION)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

// ── Fetch ─────────────────────────────────────────────────────────────────────

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Only handle same-origin requests
  if (url.origin !== self.location.origin) return;

  // Skip API routes
  if (url.pathname.startsWith("/api/")) return;
  // Defense-in-depth: never touch Vite dev server modules. If a stale install
  // ever races with `pnpm dev` on the same origin, we must not cache or serve
  // these — they only exist while the dev server is running.
  if (
    url.pathname.startsWith("/@vite/") ||
    url.pathname.startsWith("/@react-refresh") ||
    url.pathname.startsWith("/@id/") ||
    url.pathname.startsWith("/@fs/") ||
    url.pathname.startsWith("/src/") ||
    url.pathname.startsWith("/node_modules/.vite/")
  ) {
    return;
  }

  // Static assets: cache-first
  // `/assets/` is where Vite emits hashed JS/CSS bundles in prod builds —
  // without this, an installed PWA loads the cached HTML shell offline but
  // can't fetch its own bundles, ending up on a blank page.
  if (
    url.pathname.startsWith("/assets/") ||
    url.pathname.startsWith("/icons/") ||
    url.pathname.startsWith("/wasm/") ||
    url.pathname.endsWith(".js") ||
    url.pathname.endsWith(".css") ||
    url.pathname.endsWith(".png") ||
    url.pathname.endsWith(".svg") ||
    url.pathname.endsWith(".ico") ||
    url.pathname.endsWith(".woff2")
  ) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then(async (response) => {
          const clone = response.clone();
          const cache = await caches.open(CACHE_VERSION);
          cacheCleanResponse(cache, request, clone);
          return response;
        });
      }),
    );
    return;
  }

  // Navigation requests: network-first, fallback to cached shell
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then(async (response) => {
          const clone = response.clone();
          const cache = await caches.open(CACHE_VERSION);
          cacheCleanResponse(cache, request, clone);
          return response;
        })
        .catch(() => caches.match("/").then((cached) => cached ?? Response.error())),
    );
    return;
  }

  // Everything else: network with cache fallback
  event.respondWith(
    fetch(request).catch(() => caches.match(request).then((cached) => cached ?? Response.error())),
  );
});

// ── Periodic Background Sync ────────────────────────────────────────────────
//
// Chromium-only feature (Chrome / Edge / Brave on installed PWAs). The browser
// wakes the SW at OS-chosen intervals — minimum 12 hours per the spec, in
// practice 12h–24h on desktop Chrome. We CAN'T request a 1-minute tick: the
// browser throttles aggressively to protect battery.
//
// When the periodicsync event fires we look for an open client and ask it to
// drive an engine tick + catch-up. If no client is open, we fall back to a
// notification inviting the user to open the app, which on click reopens the
// PWA — the boot-time catch-up then handles missed runs.

const PERIODIC_SYNC_TAG = "supernote-automation-tick";

self.addEventListener("periodicsync", (event) => {
  if (event.tag !== PERIODIC_SYNC_TAG) return;
  event.waitUntil(handlePeriodicSync());
});

async function handlePeriodicSync() {
  const clientsList = await self.clients.matchAll({
    type: "window",
    includeUncontrolled: true,
  });

  if (clientsList.length > 0) {
    // A tab is open — even backgrounded. Ask it to nudge the vault worker.
    for (const client of clientsList) {
      client.postMessage({ type: "AUTOMATION_PERIODIC_TICK" });
    }
    return;
  }

  // No open client — show a low-priority notification that, on click, opens
  // the PWA so the boot catch-up flow runs.
  try {
    await self.registration.showNotification("Supernote", {
      body: "Routines à exécuter — ouvrir l'app pour rattraper.",
      tag: "supernote-routines-pending",
      silent: true,
      requireInteraction: false,
      data: { reason: "periodic-sync" },
    });
  } catch (err) {
    // Notification permission not granted — nothing more we can do.
    console.warn("[sw] showNotification refused", err);
  }
}

self.addEventListener("notificationclick", (event) => {
  if (event.notification.data?.reason !== "periodic-sync") return;
  event.notification.close();
  event.waitUntil(
    (async () => {
      const clientsList = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const existing = clientsList.find((c) => c.url.includes(self.location.origin));
      if (existing) return existing.focus();
      return self.clients.openWindow("/");
    })(),
  );
});

// Allow the client to query whether periodic sync is registered, so the UI
// can show an enablement toggle without re-registering on every navigation.
self.addEventListener("message", (event) => {
  if (event.data?.type === "PING_PERIODIC_SYNC") {
    event.ports[0]?.postMessage({ ok: true });
  }
});
