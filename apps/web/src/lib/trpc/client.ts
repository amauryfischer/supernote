/**
 * tRPC client for the renderer process.
 *
 * Priority order (runtime detection):
 *   1. Electron  — window.__supernoteIPC is present → use IPC bridge
 *   2. PWA/Chrome — 'showDirectoryPicker' in window → use vault Web Worker
 *   3. Degraded   — Safari / Firefox without FSA → localStorage mode
 *
 * Custom link: we implement a minimal Observable-compatible shape inline
 * (the { subscribe } object tRPC links must return) to avoid importing from
 * @trpc/server/observable which is not a direct dep of apps/web.
 */

import { createTRPCReact } from "@trpc/react-query";
import { createTRPCClient, type TRPCLink, type TRPCClientRuntime } from "@trpc/client";
import type { AppRouter } from "@supernote/ipc";
import { browserVaultLink } from "./browser-link";

// ── Browser global type augmentation ─────────────────────────────────────────

interface IpcOkResponse {
  ok: true;
  value: unknown;
}

interface IpcErrResponse {
  ok: false;
  error: { code: string; message: string; details?: unknown };
}

interface SupernoteIPC {
  invoke: (
    path: string,
    type: "query" | "mutation",
    input?: unknown,
  ) => Promise<IpcOkResponse | IpcErrResponse>;
}

declare global {
  interface Window {
    __supernoteIPC?: SupernoteIPC;
  }
}

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

// ── IPC link — delegates to preload bridge ────────────────────────────────────

function ipcLink(): TRPCLink<AppRouter> {
  return (_runtime: TRPCClientRuntime) =>
    ({ op }) =>
      // The returned observable is cast as `any` to satisfy tRPC v11's internal
      // Observable generic without pulling in @trpc/server as a direct dep.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      makeObservable((observer) => {
        const ipc = typeof window !== "undefined" ? window.__supernoteIPC : undefined;

        if (!ipc) {
          observer.error(
            new Error(
              "[Supernote mode dégradé] window.__supernoteIPC non disponible. " +
                "Lancez l'application Electron pour un accès complet.",
            ),
          );
          return;
        }

        const rpcType = op.type === "subscription" ? "query" : op.type;

        void ipc
          .invoke(op.path, rpcType, op.input)
          .then((res) => {
            if (res.ok) {
              observer.next({ result: { data: res.value } });
              observer.complete();
            } else {
              observer.error(
                Object.assign(new Error(res.error.message), {
                  code: res.error.code,
                  details: res.error.details,
                }),
              );
            }
          })
          .catch((err: unknown) => {
            observer.error(err instanceof Error ? err : new Error(String(err)));
          });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      }) as any;
}

// ── Runtime link detection ────────────────────────────────────────────────────

/**
 * Returns true when running in a Chromium browser with FSA support but
 * without Electron's IPC bridge — the PWA mode.
 */
export function isBrowserPwaMode(): boolean {
  if (typeof window === "undefined") return false;
  if (window.__supernoteIPC) return false;
  return "showDirectoryPicker" in window;
}

/**
 * Returns true when running inside Electron (IPC bridge present).
 */
export function isElectronMode(): boolean {
  return typeof window !== "undefined" && Boolean(window.__supernoteIPC);
}

function selectLink(): TRPCLink<AppRouter> {
  if (typeof window === "undefined") {
    // SSR — return a no-op link; procedures are never called server-side
    return (_runtime: TRPCClientRuntime) =>
      ({ op }) =>
        makeObservable((observer) => {
          observer.error(new Error("tRPC: SSR context, no link available"));
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        }) as any;
  }
  if (isElectronMode()) return ipcLink();
  if (isBrowserPwaMode()) return browserVaultLink();
  return ipcLink(); // degraded: will show the "mode dégradé" error
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
