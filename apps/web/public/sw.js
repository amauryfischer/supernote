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
// Cache dédié au partage PWA (share-target) : jamais purgé à l'activation,
// son entrée "pending" survit jusqu'à ce que la route /share la consomme.
const SHARE_INBOX_CACHE = "share-inbox";

const text = (v) => (typeof v === "string" ? v : "");

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
            .filter((key) => key !== CACHE_VERSION && key !== SHARE_INBOX_CACHE)
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

  // Cible du Web Share Target API : range le FormData en Cache Storage et
  // redirige vers /share, qui crée la note Inbox (pas de fenêtre ouverte par
  // l'OS avant la réponse, donc pas d'autre moyen de faire traverser les
  // fichiers/texte partagés jusqu'à la page).
  if (request.method === "POST" && url.pathname === "/share-target") {
    event.respondWith(
      (async () => {
        const form = await request.formData();
        const files = [];
        for (const file of form.getAll("files")) {
          if (!(file instanceof File) || !file.type.startsWith("image/")) continue;
          const bytes = new Uint8Array(await file.arrayBuffer());
          let bin = "";
          for (const b of bytes) bin += String.fromCharCode(b);
          files.push({ name: file.name, type: file.type, dataUrl: `data:${file.type};base64,${btoa(bin)}` });
        }
        const shared = { title: text(form.get("title")), text: text(form.get("text")), url: text(form.get("url")), files };
        const cache = await caches.open(SHARE_INBOX_CACHE);
        await cache.put("/share-target/pending", new Response(JSON.stringify(shared), { headers: { "Content-Type": "application/json" } }));
        // "partage" et non "share" : /share sert share.html (page invitée du
        // partage par lien), pas la route SPA.
        return Response.redirect("/partage?pending=1", 303);
      })(),
    );
    return;
  }

  // Only handle same-origin requests
  if (url.origin !== self.location.origin) return;

  // /admin : jamais en cache (liste des espaces) et prompt Basic Auth natif.
  if (url.pathname.startsWith("/api/") || url.pathname === "/admin" || url.pathname.startsWith("/s/")) return;
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

// ── Web Push ──────────────────────────────────────────────────────────────────

// Revérifiés ici : le SW ouvre des fenêtres avec ces valeurs.
function internalPath(url) {
  try {
    const u = new URL(url, self.location.origin);
    return u.origin === self.location.origin ? u.pathname + u.search + u.hash : "/";
  } catch {
    return "/";
  }
}

function httpsUrl(url) {
  try {
    return new URL(url).protocol === "https:" ? url : "";
  } catch {
    return "";
  }
}

async function relayToVisibleWindow(payload) {
  const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  const visible = windows.find((c) => c.visibilityState === "visible");
  if (visible) visible.postMessage({ type: "PUSH_RECEIVED", payload });
}

// Base dédiée au pont page → SW (jeton Gmail, historyId, badge) : jamais la
// base des handles de coffre, pour ne pas faire évoluer sa version.
function kv(mode, fn) {
  return new Promise((resolve) => {
    const open = indexedDB.open("supernote-sw", 1);
    open.onupgradeneeded = () => open.result.createObjectStore("kv");
    open.onerror = () => resolve(undefined);
    open.onsuccess = () => {
      const db = open.result;
      const req = fn(db.transaction("kv", mode).objectStore("kv"));
      req.onsuccess = () => {
        resolve(req.result);
        db.close();
      };
      req.onerror = () => {
        resolve(undefined);
        db.close();
      };
    };
  });
}
const kvGet = (key) => kv("readonly", (s) => s.get(key));
const kvSet = (key, value) => kv("readwrite", (s) => s.put(value, key));

async function gmailToken() {
  const t = await kvGet("gmailToken");
  return t && typeof t.token === "string" && t.expiresAt > Date.now() + 60_000 ? t.token : "";
}

async function gmail(token, path, init = {}) {
  const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...(init.body ? { "Content-Type": "application/json" } : {}) },
  });
  if (!res.ok) throw new Error(`gmail ${res.status}`);
  return res.status === 204 ? null : res.json();
}

async function setBadge(n) {
  await kvSet("badgeCount", n);
  if ("setAppBadge" in self.navigator) await (n > 0 ? self.navigator.setAppBadge(n) : self.navigator.clearAppBadge()).catch(() => undefined);
}

const senderName = (from) => (from.match(/^\s*"?([^"<]+?)"?\s*</)?.[1] ?? from).trim();

async function showMail(data) {
  const token = await gmailToken();
  if (!token) {
    await setBadge(((await kvGet("badgeCount")) || 0) + 1);
    return self.registration.showNotification("Du nouveau dans ta boîte", {
      tag: "mail-new",
      icon: "/icons/icon-192.png",
      data: { url: "/mail", kind: "mail" },
    });
  }
  try {
    const since = (await kvGet("mailHistoryId")) || text(data.historyId);
    const hist = await gmail(token, `history?startHistoryId=${encodeURIComponent(since)}&historyTypes=messageAdded&labelId=INBOX`);
    const added = (hist?.history ?? [])
      .flatMap((h) => h.messagesAdded ?? [])
      .map((m) => m.message)
      .filter((m) => m?.labelIds?.includes("INBOX"))
      .slice(0, 5);
    if (hist?.historyId) await kvSet("mailHistoryId", String(hist.historyId));
    const inbox = await gmail(token, "labels/INBOX");
    await setBadge(inbox?.threadsUnread ?? inbox?.messagesUnread ?? 0);
    if (added.length === 0) {
      // Archivage ou lecture : rien à dire, mais Safari exige une notification par push.
      await self.registration.showNotification("Supernote", { tag: "mail-sync", silent: true });
      const shown = await self.registration.getNotifications({ tag: "mail-sync" });
      shown.forEach((n) => n.close());
      return;
    }
    const metas = await Promise.all(
      added.map((m) => gmail(token, `messages/${m.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject`)),
    );
    const header = (m, name) => m.payload?.headers?.find((h) => h.name === name)?.value ?? "";
    const one = metas.length === 1 ? metas[0] : null;
    return self.registration.showNotification(
      one ? senderName(header(one, "From")) : `${metas.length} nouveaux mails`,
      {
        body: one ? header(one, "Subject") : metas.map((m) => senderName(header(m, "From"))).join(", "),
        tag: "mail-new",
        icon: "/icons/icon-192.png",
        data: { kind: "mail", url: one ? `/mail?thread=${encodeURIComponent(one.threadId)}` : "/mail", threadId: one?.threadId ?? "" },
        actions: one ? [{ action: "archive", title: "Archiver" }, { action: "read", title: "Lu" }] : [],
      },
    );
  } catch {
    return self.registration.showNotification("Du nouveau dans ta boîte", {
      tag: "mail-new",
      icon: "/icons/icon-192.png",
      data: { url: "/mail", kind: "mail" },
    });
  }
}

self.addEventListener("push", (event) => {
  let data = {};
  try {
    const parsed = event.data ? event.data.json() : null;
    if (parsed && typeof parsed === "object") data = parsed;
  } catch {
    /* charge illisible : notification générique */
  }
  const payload = {
    title: text(data.title) || "Supernote",
    body: text(data.body),
    url: internalPath(text(data.url) || "/"),
    tag: text(data.tag),
    joinUrl: httpsUrl(text(data.joinUrl)),
  };
  event.waitUntil(
    (async () => {
      await relayToVisibleWindow(payload);
      if (data.kind === "mail") {
        await showMail(data);
        return;
      }
      // Toujours afficher : Safari révoque la permission d'un site qui reçoit un push sans notification.
      await self.registration.showNotification(payload.title, {
        body: payload.body,
        tag: payload.tag || undefined,
        icon: "/icons/icon-192.png",
        data: { url: payload.url, joinUrl: payload.joinUrl },
        actions: payload.joinUrl ? [{ action: "join", title: "Rejoindre" }] : [],
      });
    })(),
  );
});

self.addEventListener("notificationclick", (event) => {
  const data = event.notification.data ?? {};
  event.notification.close();
  if ((event.action === "archive" || event.action === "read") && data.kind === "mail" && data.threadId) {
    const label = event.action === "archive" ? "INBOX" : "UNREAD";
    event.waitUntil(
      (async () => {
        const token = await gmailToken();
        if (token) {
          try {
            await gmail(token, `threads/${encodeURIComponent(data.threadId)}/modify`, {
              method: "POST",
              body: JSON.stringify({ removeLabelIds: [label] }),
            });
            const inbox = await gmail(token, "labels/INBOX");
            await setBadge(inbox?.threadsUnread ?? 0);
            return;
          } catch {
            /* repli : la page exécute via l'outbox */
          }
        }
        await self.clients.openWindow(`/mail?thread=${encodeURIComponent(data.threadId)}&action=${event.action}`);
      })(),
    );
    return;
  }
  if (event.action === "join") {
    const joinUrl = httpsUrl(text(data.joinUrl));
    if (joinUrl) event.waitUntil(self.clients.openWindow(joinUrl));
    return;
  }
  // periodic-sync : ramener l'app sans changer de page.
  const target = data.reason === "periodic-sync" ? null : internalPath(text(data.url) || "/");
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const existing = windows.find((c) => c.url.startsWith(self.location.origin));
      if (!existing) return self.clients.openWindow(target ?? "/");
      await existing.focus();
      if (target) await existing.navigate(target).catch(() => self.clients.openWindow(target));
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
