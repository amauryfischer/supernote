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
// Whether the last INIT_VAULT was a cloud vault (OPFS-backed handle). Replayed
// alongside `lastVaultHandle` so an HMR re-spawn keeps the cloud semantics
// (no FSA mirror, "Coffre cloud" label) instead of degrading to a folder init.
let lastInitCloud = false;
// Last VAULT_READY payload, stashed so a consumer that subscribes AFTER the
// worker already emitted READY can recover the vault identity instead of
// hanging forever (the `supernote:vault-ready` window event already fired and
// won't replay). Mirrors how `isWorkerReady()` guards the same mount race.
let lastVaultReady: { vaultId: string; vaultName: string } | null = null;
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
// True while we're between `terminateVaultWorker()` and the next
// VAULT_READY — used to tell the Provider that the upcoming refresh is a
// SWITCH (drop all cache) rather than a first boot (just invalidate).
let pendingSwitch = false;
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
    // Forward worker-side console.info/warn/error to the main devtools console
    // so MCP browser tooling can capture them — workers don't share the main
    // console transport with the extension's read_console_messages.
    if (msg && typeof msg === "object" && "__log" in (msg as object)) {
      const line = (msg as { __log: string }).__log;
      if (line.startsWith("[error]")) console.error("[worker]", line);
      else if (line.startsWith("[warn]")) console.warn("[worker]", line);
      else console.log("[worker]", line);
      return;
    }
    if (msg && typeof msg === "object" && "type" in (msg as object)) {
      const t = (msg as { type: string }).type;
      if (t === "VAULT_READY" || t === "VAULT_ERROR") {
        console.info("[vault-worker]", t, msg);
      }
      if (t === "VAULT_ERROR") {
        // Surface init failures to UI consumers via a window event — the same
        // worker-instance-agnostic channel as VAULT_READY. A listener bound to
        // the worker port directly would miss this if the port was re-spawned
        // (e.g. PwaVaultSetup's loading overlay after a vault switch).
        if (typeof window !== "undefined") {
          const error =
            (msg as { error?: string }).error ??
            "Erreur d'initialisation du coffre.";
          window.dispatchEvent(
            new CustomEvent("supernote:vault-error", { detail: { error } }),
          );
        }
      }
      if (t === "INDEX_PROGRESS") {
        // Background reindex adopted/swept rows AFTER VAULT_READY fired —
        // the queries already refetched once with the just-hydrated DB and
        // wouldn't pick up the newly indexed entities/folders without a
        // nudge. Dispatch a follow-up event so the Provider invalidates
        // the cache a second time and the sidebar/notes list catches up.
        if (typeof window !== "undefined") {
          console.info("[browser-link] INDEX_PROGRESS — re-invalidating queries", msg);
          window.dispatchEvent(
            new CustomEvent("supernote:index-progress", { detail: msg }),
          );
        }
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
        // `wasReady` is the historical "we had a ready worker before this"
        // signal (post-init re-emit). On a vault switch we always go
        // ready=false (via setWorkerReady or terminate), so `wasReady`
        // alone can't distinguish "fresh boot" from "switch". The
        // `pendingSwitch` flag (set in terminateVaultWorker) is the
        // authoritative switch indicator and takes precedence.
        const wasReady = vaultReady || pendingSwitch;
        const isSwitch = pendingSwitch;
        pendingSwitch = false;
        vaultReady = true;
        _workerReady = true;
        lastVaultReady = {
          vaultId: (msg as { vaultId?: string }).vaultId ?? "",
          vaultName: (msg as { vaultName?: string }).vaultName ?? "",
        };
        drainMessageQueue();
        // Tell any TanStack Query subscribers that the worker is now ready.
        // Without this, queries that fired BEFORE the worker booted (and
        // were rejected with "Vault not initialized") stay cached as errors
        // forever — `retry: false` in the QueryClient defaults means they
        // never auto-retry. The Provider listens for this event and calls
        // `queryClient.invalidateQueries()` (or `removeQueries()` on a
        // switch) so failed/stale queries refetch.
        if (typeof window !== "undefined") {
          console.info("[browser-link] dispatching supernote:vault-ready", { wasReady, isSwitch });
          window.dispatchEvent(
            new CustomEvent("supernote:vault-ready", {
              detail: { wasReady, isSwitch, ...lastVaultReady },
            }),
          );
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
    workerInstance.postMessage(
      { type: "INIT_VAULT", handle: lastVaultHandle, cloud: lastInitCloud },
      [],
    );
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
 *
 * Pass `opts.resetStorage = true` when switching to a different vault folder
 * so the worker unlinks the OPFS-resident DB (via the SAH pool API) before
 * booting the new vault. Otherwise the new worker reattaches to the previous
 * vault's SAH-backed file and the old data resurfaces in /notes & co.
 */
export function initWorkerVault(
  handle: FileSystemDirectoryHandle,
  opts: { resetStorage?: boolean; cloud?: boolean } = {},
): void {
  // Order matters: getWorker() inspects `lastVaultHandle` to decide whether
  // to AUTO-REPLAY a prior INIT_VAULT on a freshly-spawned worker (HMR /
  // dev reload safety). If we set lastVaultHandle BEFORE spawning, the
  // auto-replay fires for the new vault WITHOUT carrying our `resetStorage`
  // flag, racing our proper INIT below — and the first init persists the
  // still-polluted OPFS into the NEW vault's `.supernote/index.db` mirror
  // before the reset path even runs. Spawn first → set state → post.
  const worker = getWorker();
  lastVaultHandle = handle;
  lastInitCloud = opts.cloud === true;
  worker.postMessage(
    {
      type: "INIT_VAULT",
      handle,
      resetStorage: opts.resetStorage === true,
      cloud: opts.cloud === true,
    },
    [],
  );
}

/**
 * Tear down the singleton worker so the next call to `getWorker()` spawns a
 * fresh one. Must be called before `clearOpfsDb()` when switching vaults —
 * otherwise the live SAH file handles keep `.supernote-vfs` locked and the
 * OPFS wipe silently fails, leaving the previous vault's DB in place.
 */
export function terminateVaultWorker(): void {
  if (!workerInstance) return;
  console.info("[browser-link] terminating vault worker (vault switch)");
  try {
    workerInstance.terminate();
  } catch (err) {
    console.warn("[browser-link] worker.terminate() threw", err);
  }
  workerInstance = null;
  lastVaultHandle = null;
  lastInitCloud = false;
  lastVaultReady = null;
  vaultReady = false;
  _workerReady = false;
  messageQueue = [];
  // Flag the next VAULT_READY as a vault switch so the Provider knows to
  // wipe TanStack Query cache (not just invalidate) — otherwise the user
  // would see stale rows from the previous vault flash on screen until
  // the refetch lands.
  pendingSwitch = true;
  // Tell hooks that depend on workerReady (useWorkerReady etc.) to flip
  // back to "not ready" while the new worker boots. Without this, queries
  // stay enabled and TanStack keeps surfacing the previous vault's cached
  // result for the duration of the switch.
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("supernote:vault-unready"));
  }
  // Pending RPCs targeted the now-dead worker — reject so callers don't
  // hang on the 15s timeout. The next vault will get fresh queries on
  // VAULT_READY via the Provider's invalidate hook.
  for (const [id, pending] of pendingRequests) {
    pending.reject(new Error("vault worker terminated (vault switch)"));
    pendingRequests.delete(id);
  }
  if (typeof window !== "undefined") {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (window as any).__supernoteWorker;
  }
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

/**
 * The identity of the currently-mounted vault, captured from the last
 * VAULT_READY. Null before the first ready / after a terminate. Lets a
 * consumer that subscribes once the worker is ALREADY up (so it missed the
 * `supernote:vault-ready` event) recover the vault name without a replay.
 */
export function getLastVaultReady(): { vaultId: string; vaultName: string } | null {
  return lastVaultReady;
}

// Sans ça, un remplacement à chaud laisse vivre le worker précédent — le module
// réévalué repart avec `workerInstance = null` et en démarre un second. Les deux
// se disputent alors le pool OPFS, et le nouveau échoue définitivement sur
// `createSyncAccessHandle` : le détenteur est un frère vivant, il ne mourra pas.
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    workerInstance?.terminate();
    workerInstance = null;
  });
}
