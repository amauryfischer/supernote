/**
 * browser-link — tRPC link that delegates to the vault Web Worker.
 *
 * Each request gets a unique id. The worker responds with { id, ok, result|error }.
 * A Map tracks pending promises so responses are matched correctly.
 *
 * The worker is instantiated once lazily and reused for the session.
 */

import type { TRPCLink, TRPCClientRuntime } from "@trpc/client";
import type { AppRouter } from "@supernote/ipc";
import type { WorkerResponse } from "@/lib/vault-worker/worker-protocol";

// ── Minimal observable helper (reused from client.ts pattern) ─────────────────

type AnyObserver = {
  next: (value: unknown) => void;
  error: (err: unknown) => void;
  complete: () => void;
};

function makeObservable(fn: (observer: AnyObserver) => void) {
  return {
    subscribe(observer: AnyObserver) {
      fn(observer);
      return { unsubscribe() {} };
    },
  };
}

// ── Worker singleton ──────────────────────────────────────────────────────────

let workerInstance: Worker | null = null;
// Last handle we initialised the worker with. If `getWorker()` ever has to
// re-spawn (HMR, dev reload, accidental nulling) we replay this INIT so the
// new worker isn't stuck in "Vault not initialized" forever.
let lastVaultHandle: FileSystemDirectoryHandle | null = null;
const pendingRequests = new Map<
  string,
  { resolve: (value: unknown) => void; reject: (err: Error) => void }
>();

// Outbound RPC messages that arrived before the worker emitted VAULT_READY.
// We queue them rather than send immediately because the worker's RPC handler
// rejects with "Vault not initialized" when called pre-init — that race used
// to cascade into localStore fallbacks that silently swallowed user data.
type QueuedMessage = {
  id: string;
  path: string;
  type: "query" | "mutation";
  input: unknown;
};
let messageQueue: QueuedMessage[] = [];
let vaultReady = false;
// Mirror of `vaultReady` exposed via setWorkerReady/isWorkerReady. Hoisted
// up here so getWorker() can reset it on (re-)spawn without forward-reference
// issues.
let _workerReady = false;

function drainMessageQueue(): void {
  if (!workerInstance) return;
  while (messageQueue.length) {
    const queued = messageQueue.shift()!;
    workerInstance.postMessage(queued);
  }
}

function getWorker(): Worker {
  if (workerInstance) return workerInstance;

  // Log every worker spawn so we can verify the module-scope singleton
  // genuinely persists across client-side route changes. If you see this
  // line more than once per page load, something is causing the module
  // to be re-evaluated (HMR, a stale dynamic import, etc.).
  console.info("[browser-link] spawning new vault worker (should appear at most once per page load)");

  // A re-spawned worker has not yet emitted VAULT_READY — reset the gate so
  // we don't keep posting RPCs that race against the new init.
  vaultReady = false;
  _workerReady = false;

  workerInstance = new Worker(
    new URL("../vault-worker/worker.ts", import.meta.url),
    { type: "module" },
  );

  // Expose for diagnostics in browser DevTools (window.__supernoteWorker)
  if (typeof window !== "undefined") {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__supernoteWorker = workerInstance;
  }

  workerInstance.addEventListener("message", (event: MessageEvent<WorkerResponse>) => {
    const msg = event.data as unknown;
    if (msg && typeof msg === "object" && "type" in (msg as object)) {
      const t = (msg as { type: string }).type;
      if (t === "VAULT_READY" || t === "VAULT_ERROR") {
        console.info("[vault-worker]", t, msg);
      }
      if (t === "AUTOMATION_NOTIFICATION") {
        // Forward worker-side notification dispatch to the UI. The
        // NotificationsProvider bridge picks this up and pushes into the
        // global notifications drawer + optionally fires an OS notification.
        if (typeof window !== "undefined") {
          window.dispatchEvent(
            new CustomEvent("supernote:automation-notification", {
              detail: (msg as { notification: unknown }).notification,
            }),
          );
        }
      }
      if (t === "VAULT_READY") {
        const wasReady = vaultReady;
        vaultReady = true;
        _workerReady = true;
        drainMessageQueue();
        // Tell any TanStack Query subscribers that the worker is now ready.
        // Without this, queries that fired BEFORE the worker booted (and
        // were rejected with "Vault not initialized") stay cached as errors
        // forever — `retry: false` in the QueryClient defaults means they
        // never auto-retry. The Provider listens for this event and calls
        // `queryClient.invalidateQueries()` so failed queries refetch.
        if (typeof window !== "undefined") {
          console.info("[browser-link] dispatching supernote:vault-ready", { wasReady });
          window.dispatchEvent(new CustomEvent("supernote:vault-ready", { detail: { wasReady } }));
        }
      }
    }
    const m = event.data;
    if (!m || !("id" in m)) return; // Bootstrap messages, not RPC responses

    const pending = pendingRequests.get(m.id);
    if (!pending) return;
    pendingRequests.delete(m.id);

    if (m.ok) {
      pending.resolve(m.result);
    } else {
      pending.reject(new Error(m.error));
    }
  });

  workerInstance.addEventListener("error", (event) => {
    console.error("[browser-link] worker error", event.message, event.filename, event.lineno);
  });
  workerInstance.addEventListener("messageerror", (event) => {
    console.error("[browser-link] worker messageerror", event);
  });

  // If a previous spawn already received an INIT_VAULT, replay it now so a
  // re-spawned worker bootstraps itself without waiting for PwaVaultSetup
  // to re-mount (whose `initStartedRef` would block a duplicate init).
  if (lastVaultHandle) {
    console.info("[browser-link] re-sending INIT_VAULT to fresh worker");
    workerInstance.postMessage({ type: "INIT_VAULT", handle: lastVaultHandle }, []);
  }

  return workerInstance;
}

const RPC_TIMEOUT_MS = 15_000;

let requestCounter = 0;

function nextId(): string {
  return `rpc-${++requestCounter}`;
}

// ── tRPC link factory ─────────────────────────────────────────────────────────

export function browserVaultLink(): TRPCLink<AppRouter> {
  return (_runtime: TRPCClientRuntime) =>
    ({ op }) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      makeObservable((observer) => {
        const id = nextId();
        const rpcType = op.type === "subscription" ? "query" : op.type;

        const promise = new Promise<unknown>((resolve, reject) => {
          pendingRequests.set(id, { resolve, reject });
          // Safety timeout: if the worker never responds (e.g. failed to init
          // and silently dropped messages), reject so the caller can fall back.
          setTimeout(() => {
            if (pendingRequests.delete(id)) {
              reject(new Error(`RPC timeout after ${RPC_TIMEOUT_MS}ms: ${op.path}`));
            }
          }, RPC_TIMEOUT_MS);
        });

        const worker = getWorker();
        const outbound = { id, path: op.path, type: rpcType, input: op.input };
        if (vaultReady) {
          worker.postMessage(outbound);
        } else {
          // Worker not yet initialized — queue and let the VAULT_READY
          // listener drain. Without this, the RPC would race the worker
          // bootstrap and the worker would reject with "Vault not initialized",
          // causing callers to fall back to non-persistent localStorage.
          messageQueue.push(outbound);
        }

        void promise
          .then((result) => {
            observer.next({ result: { data: result } });
            observer.complete();
          })
          .catch((err: unknown) => {
            observer.error(err instanceof Error ? err : new Error(String(err)));
          });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      }) as any;
}

/**
 * Send INIT_VAULT message to the singleton worker.
 * Must be called after showDirectoryPicker() on the UI thread.
 */
export function initWorkerVault(handle: FileSystemDirectoryHandle): void {
  lastVaultHandle = handle;
  const worker = getWorker();
  worker.postMessage({ type: "INIT_VAULT", handle }, []);
}

/**
 * Ask the worker to synchronously flush any pending DB writes. Returns a
 * promise that resolves when the bytes are on disk. No-op if the worker
 * was never spawned. Used on navigation / `beforeunload` so we don't drop
 * an in-flight debounced persist.
 */
export function flushVaultWorker(): Promise<void> {
  // If no worker has been created yet, there is nothing to flush — and
  // we deliberately do NOT spawn one here.
  if (!workerInstance) return Promise.resolve();
  if (!_workerReady) return Promise.resolve();
  const id = nextId();
  const promise = new Promise<void>((resolve) => {
    pendingRequests.set(id, {
      resolve: () => resolve(),
      reject: () => resolve(), // Best-effort: never reject the flush.
    });
    setTimeout(() => {
      if (pendingRequests.delete(id)) resolve();
    }, 2_000);
  });
  workerInstance.postMessage({ type: "FLUSH", id });
  return promise;
}

/**
 * Listen for vault worker bootstrap messages (VAULT_READY, VAULT_ERROR, INDEX_PROGRESS).
 * Returns a cleanup function.
 */
export function onWorkerMessage(
  handler: (msg: unknown) => void,
): () => void {
  const worker = getWorker();
  const listener = (event: MessageEvent<unknown>) => {
    const msg = event.data;
    if (msg && typeof msg === "object" && "type" in (msg as object)) {
      handler(msg);
    }
  };
  worker.addEventListener("message", listener);
  return () => worker.removeEventListener("message", listener);
}

/**
 * Check if the vault worker has been initialized (vault is ready).
 * True after VAULT_READY has been received.
 *
 * Note: `_workerReady` itself is declared at the top of this module so that
 * `getWorker()` can reset it on (re-)spawn without TDZ trouble.
 */
export function setWorkerReady(ready: boolean): void {
  _workerReady = ready;
  vaultReady = ready;
  if (ready) drainMessageQueue();
  else messageQueue = [];
}
export function isWorkerReady(): boolean {
  return _workerReady;
}
