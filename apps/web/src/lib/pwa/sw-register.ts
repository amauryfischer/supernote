/**
 * sw-register — registers the Service Worker for PWA offline support.
 *
 * Designed to be called once from the root layout (client-side only).
 * Safe to call multiple times (navigator.serviceWorker deduplicates).
 */

export async function registerServiceWorker(): Promise<void> {
  if (typeof window === "undefined") return;
  if (!("serviceWorker" in navigator)) return;
  // Never register in dev: the SW would pre-cache an HTML shell that imports
  // Vite-only virtual modules (/src/main.tsx, /@vite/client, /@react-refresh),
  // leaving an installed PWA permanently broken once the dev server stops.
  if (import.meta.env.DEV) return;

  try {
    const registration = await navigator.serviceWorker.register("/sw.js", {
      scope: "/",
    });
    registration.addEventListener("updatefound", () => {
      const newWorker = registration.installing;
      if (!newWorker) return;
      newWorker.addEventListener("statechange", () => {
        if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
          // New SW waiting — could notify user to refresh
          console.info("[SW] Update available. Refresh to apply.");
        }
      });
    });
    console.info("[SW] Registered", registration.scope);

    // Best-effort Periodic Background Sync. Chromium-only API, gated behind
    // PWA install + notifications permission + browser-internal site
    // engagement heuristics. Failure is non-fatal — the engine still runs
    // every minute while a client is open, and `runCatchUpCron` covers the
    // missed-fire case on next boot.
    await tryRegisterPeriodicSync(registration);
  } catch (err) {
    console.warn("[SW] Registration failed", err);
  }
}

const PERIODIC_SYNC_TAG = "supernote-automation-tick";

async function tryRegisterPeriodicSync(registration: ServiceWorkerRegistration): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const reg = registration as any;
  if (!reg.periodicSync) {
    console.info("[SW] periodicSync API unavailable (non-Chromium or no PWA install)");
    return;
  }
  try {
    // Permission for Periodic Background Sync is part of the permissions API.
    const status = await navigator.permissions.query({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      name: "periodic-background-sync" as any,
    });
    if (status.state !== "granted") {
      console.info("[SW] periodic-background-sync permission state:", status.state);
      return;
    }
    const tags: string[] = await reg.periodicSync.getTags();
    if (tags.includes(PERIODIC_SYNC_TAG)) return;
    await reg.periodicSync.register(PERIODIC_SYNC_TAG, {
      // Browser enforces ≥12h on desktop, ≥24h on mobile. Ours is a hint.
      minInterval: 12 * 60 * 60 * 1000,
    });
    console.info("[SW] periodicSync registered");
  } catch (err) {
    console.warn("[SW] periodicSync registration failed", err);
  }
}

/**
 * Bridge SW → vault worker: when the SW posts AUTOMATION_PERIODIC_TICK, ask
 * the vault worker to run a tick + catch-up immediately. Must be called once
 * from the client after the worker has emitted VAULT_READY.
 */
export function listenForPeriodicTicks(onTick: () => void): () => void {
  if (typeof navigator === "undefined" || !navigator.serviceWorker) return () => {};
  const handler = (event: MessageEvent) => {
    if (event.data?.type === "AUTOMATION_PERIODIC_TICK") onTick();
  };
  navigator.serviceWorker.addEventListener("message", handler);
  return () => navigator.serviceWorker.removeEventListener("message", handler);
}
