/**
 * tRPC client for the renderer process (PWA-only).
 *
 * All procedures are routed to the in-browser vault Web Worker via
 * `browserVaultLink`. Electron / IPC bridge support has been removed —
 * the app is now 100% PWA.
 */

import { createTRPCReact } from "@trpc/react-query";
import { createTRPCClient, type TRPCLink, type TRPCClientRuntime } from "@trpc/client";
import type { AppRouter } from "@supernote/ipc";
import { browserVaultLink } from "./browser-link";

// ── Minimal observer type ──────────────────────────────────────────────────────
// Matches tRPC's internal Observer shape without importing from @trpc/server.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyObserver = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  next: (value: any) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  error: (err: any) => void;
  complete: () => void;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MinimalObservable = { subscribe: (observer: AnyObserver) => { unsubscribe: () => void } };

function makeObservable(fn: (observer: AnyObserver) => void): MinimalObservable {
  return {
    subscribe(observer) {
      fn(observer);
      return { unsubscribe() {} };
    },
  };
}

// ── Runtime link detection ────────────────────────────────────────────────────

/**
 * Returns true when running in a browser with File System Access API support.
 * Some UI may still want to know if FSA is available (e.g. to surface a
 * vault-picker affordance). All data calls go through `browserVaultLink`
 * regardless.
 */
export function isBrowserPwaMode(): boolean {
  if (typeof window === "undefined") return false;
  return "showDirectoryPicker" in window;
}

/**
 * localStorage marker set by the cloud-vault setup flow (see PwaVaultSetup).
 * Its presence means "this device runs a worker-backed vault whose root is an
 * OPFS scratch dir, replicated via online-sync" — even on browsers without the
 * File System Access folder picker (Android Chrome, Safari, Firefox).
 */
export const CLOUD_VAULT_KEY = "supernote.cloud";

/**
 * True when this browser can host a worker-backed vault WITHOUT a user-picked
 * folder: it needs OPFS (`navigator.storage.getDirectory`) for the SQLite SAH
 * pool + a Web Worker. This is far broader than {@link isBrowserPwaMode} (which
 * requires the FSA folder picker, Chromium-desktop-only) — OPFS ships on every
 * modern engine, so cloud vaults work on phones too.
 */
export function isCloudCapable(): boolean {
  if (typeof window === "undefined") return false;
  return (
    typeof Worker !== "undefined" &&
    typeof navigator !== "undefined" &&
    !!navigator.storage &&
    typeof navigator.storage.getDirectory === "function"
  );
}

/** True when a cloud vault has been set up on this device. */
export function isCloudVaultActive(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(CLOUD_VAULT_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * True when data calls should go through the vault Web Worker (tRPC) rather
 * than the degraded localStorage mock. Either the browser has the FSA folder
 * picker (so a folder/git vault is possible) OR a cloud vault is active on a
 * cloud-capable engine.
 */
export function hasWorkerBackend(): boolean {
  return isBrowserPwaMode() || (isCloudCapable() && isCloudVaultActive());
}

function selectLink(): TRPCLink<AppRouter> {
  if (typeof window === "undefined") {
    // SSR — return a no-op link; procedures are never called server-side
    return (_runtime: TRPCClientRuntime) =>
      () =>
        makeObservable((observer) => {
          observer.error(new Error("tRPC: SSR context, no link available"));
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        }) as any;
  }
  return browserVaultLink();
}

// ── React tRPC instance ────────────────────────────────────────────────────────

export const trpc = createTRPCReact<AppRouter>();

// ── Vanilla client (for use outside React) ─────────────────────────────────────

export const trpcVanillaClient = createTRPCClient<AppRouter>({
  links: [selectLink()],
});

// ── Factory exported for Provider.tsx ─────────────────────────────────────────

export function createTrpcReactClient() {
  return trpc.createClient({ links: [selectLink()] });
}
