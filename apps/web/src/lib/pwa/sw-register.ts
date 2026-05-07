/**
 * sw-register — registers the Service Worker for PWA offline support.
 *
 * Designed to be called once from the root layout (client-side only).
 * Safe to call multiple times (navigator.serviceWorker deduplicates).
 */

export async function registerServiceWorker(): Promise<void> {
  if (typeof window === "undefined") return;
  if (!("serviceWorker" in navigator)) return;

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
  } catch (err) {
    console.warn("[SW] Registration failed", err);
  }
}
