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
const pendingRequests = new Map<
  string,
  { resolve: (value: unknown) => void; reject: (err: Error) => void }
>();

function getWorker(): Worker {
  if (workerInstance) return workerInstance;

  workerInstance = new Worker(
    new URL("../vault-worker/worker.ts", import.meta.url),
    { type: "module" },
  );

  workerInstance.addEventListener("message", (event: MessageEvent<WorkerResponse>) => {
    const msg = event.data;
    if (!msg || !("id" in msg)) return; // Bootstrap messages, not RPC responses

    const pending = pendingRequests.get(msg.id);
    if (!pending) return;
    pendingRequests.delete(msg.id);

    if (msg.ok) {
      pending.resolve(msg.result);
    } else {
      pending.reject(new Error(msg.error));
    }
  });

  workerInstance.addEventListener("error", (event) => {
    console.error("[browser-link] worker error", event);
  });

  return workerInstance;
}

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
        });

        const worker = getWorker();
        worker.postMessage({ id, path: op.path, type: rpcType, input: op.input });

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
  const worker = getWorker();
  worker.postMessage({ type: "INIT_VAULT", handle }, []);
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
 */
let _workerReady = false;
export function setWorkerReady(ready: boolean): void {
  _workerReady = ready;
}
export function isWorkerReady(): boolean {
  return _workerReady;
}
