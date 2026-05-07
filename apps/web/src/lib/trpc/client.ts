/**
 * tRPC client for the renderer process.
 *
 * In Electron, delegates to window.__supernoteIPC.invoke (IPC bridge).
 * In browser dev mode (no IPC available), uses a mock link that returns
 * a friendly "mode dégradé" error so the app stays usable without crashing.
 *
 * Custom link: we implement a minimal Observable-compatible shape inline
 * (the { subscribe } object tRPC links must return) to avoid importing from
 * @trpc/server/observable which is not a direct dep of apps/web.
 */

import { createTRPCReact } from "@trpc/react-query";
import { createTRPCClient, type TRPCLink, type TRPCClientRuntime } from "@trpc/client";
import type { AppRouter } from "@supernote/ipc";

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

// ── React tRPC instance ────────────────────────────────────────────────────────

export const trpc = createTRPCReact<AppRouter>();

// ── Vanilla client (for use outside React) ─────────────────────────────────────

export const trpcVanillaClient = createTRPCClient<AppRouter>({
  links: [ipcLink()],
});

// ── Factory exported for Provider.tsx ─────────────────────────────────────────

export function createTrpcReactClient() {
  return trpc.createClient({ links: [ipcLink()] });
}
