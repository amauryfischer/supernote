"use client";

/**
 * GitSyncProvider — background sync orchestrator for the Git-linked vault.
 *
 * Lives at the root of the React tree (mounted by `RootLayout`). At mount,
 * it reads the persisted git config from IndexedDB. If a config is found,
 * it kicks off a periodic `syncOnce` loop. Otherwise it stays inert (no
 * timers, no fetches) — local-only vaults and degraded mode pay zero cost.
 *
 * Triggers a sync on:
 *   - 30 s after mount (initial — avoids competing with the worker boot)
 *   - Every 2 min when online (background loop)
 *   - Browser tab visible again (`visibilitychange`)
 *   - Network restored (`online` event)
 *   - Caller invokes `syncNow()` (button in topbar / settings)
 *
 * Sync events are serialised through a single Promise chain so we never run
 * two cycles in parallel (which would race the IndexedDB lastSyncSha pointer).
 *
 * Status surface: any consumer can read the current state via `useGitSync()`
 * to render an indicator dot, a toast, a conflicts panel, etc.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useVault } from "@/lib/pwa/PwaVaultSetup";
import { loadGitConfig, saveGitConfig, type StoredGitConfig } from "./config-storage";
import { syncOnce, type SyncSummary } from "./github-sync";

export type GitSyncStatus =
  | "disabled" // No git config (local-only vault)
  | "idle" // Config loaded, no sync running, waiting for next tick
  | "syncing" // syncOnce currently in flight
  | "ok" // Last cycle succeeded
  | "error" // Last cycle errored — see errorMsg
  | "offline"; // navigator.onLine is false

export interface GitSyncState {
  status: GitSyncStatus;
  lastSyncAt: string | null;
  lastSummary: SyncSummary | null;
  errorMsg: string | null;
  config: StoredGitConfig | null;
  /** Run one sync cycle immediately. Returns the summary when done. */
  syncNow: () => Promise<SyncSummary | null>;
  /** Force re-read of the config from IndexedDB (after /parametres updates it). */
  reloadConfig: () => Promise<void>;
}

const GitSyncContext = createContext<GitSyncState | null>(null);

const INITIAL_DELAY_MS = 30_000; // wait 30 s after mount before first sync
const POLL_INTERVAL_MS = 120_000; // 2 min background poll

export function GitSyncProvider({ children }: { children: React.ReactNode }) {
  const vault = useVault();
  const [config, setConfig] = useState<StoredGitConfig | null>(null);
  const [status, setStatus] = useState<GitSyncStatus>("disabled");
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const [lastSummary, setLastSummary] = useState<SyncSummary | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Serialisation: every sync goes through this chain so concurrent triggers
  // (focus + online + interval firing back-to-back) collapse into a single
  // run instead of racing the lastSyncSha pointer.
  const syncChain = useRef<Promise<SyncSummary | null>>(Promise.resolve(null));

  // Load the config once at mount. We re-load when the vault becomes ready
  // (in case the user just finished the Git setup flow).
  const reloadConfig = useCallback(async () => {
    const c = await loadGitConfig().catch(() => null);
    setConfig(c);
    setStatus(c ? "idle" : "disabled");
  }, []);

  useEffect(() => {
    void reloadConfig();
  }, [reloadConfig, vault?.state]);

  // Get the FSA handle from the vault context — we need it to read/write
  // the worktree during sync. The handle is also persisted in IndexedDB
  // but reading via the vault context skips a roundtrip and ensures we
  // use the same handle the worker has open.
  const vaultHandleRef = useRef<FileSystemDirectoryHandle | null>(null);
  useEffect(() => {
    if (!vault) return;
    // The vault context doesn't expose the raw handle, but the
    // vault-handle-storage helper does. We lazy-import to avoid bundling
    // it in non-PWA paths.
    void import("@/lib/vault-worker/vault-handle-storage").then(async ({ loadVaultHandle }) => {
      const h = await loadVaultHandle().catch(() => null);
      vaultHandleRef.current = h;
    });
  }, [vault]);

  const runSync = useCallback(async (): Promise<SyncSummary | null> => {
    if (!config) return null;
    if (!vaultHandleRef.current) {
      console.warn("[git-sync] runSync: no vault handle yet");
      return null;
    }
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      setStatus("offline");
      return null;
    }
    setStatus("syncing");
    setErrorMsg(null);
    try {
      const summary = await syncOnce(
        vaultHandleRef.current,
        {
          url: config.url,
          token: config.token,
          ref: config.ref,
        },
        config.lastSyncSha ?? null,
      );
      const now = new Date().toISOString();
      const nextConfig: StoredGitConfig = {
        ...config,
        lastSyncAt: now,
        lastSyncSha: summary.headSha ?? config.lastSyncSha,
      };
      await saveGitConfig(nextConfig);
      setConfig(nextConfig);
      setLastSyncAt(now);
      setLastSummary(summary);
      setStatus("ok");
      return summary;
    } catch (err) {
      const msg = (err as Error).message ?? String(err);
      console.error("[git-sync] runSync failed:", err);
      setErrorMsg(msg);
      setStatus("error");
      return null;
    }
  }, [config]);

  const syncNow = useCallback((): Promise<SyncSummary | null> => {
    const next = syncChain.current.then(() => runSync());
    syncChain.current = next.catch(() => null);
    return next;
  }, [runSync]);

  // Background loop: initial delay, then periodic poll. Cancelled and
  // re-armed whenever the config changes (e.g. user updated the PAT in
  // /parametres).
  useEffect(() => {
    if (!config) return;
    let cancelled = false;

    const t0 = window.setTimeout(() => {
      if (cancelled) return;
      void syncNow();
    }, INITIAL_DELAY_MS);

    const t1 = window.setInterval(() => {
      if (cancelled) return;
      void syncNow();
    }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(t0);
      window.clearInterval(t1);
    };
  }, [config, syncNow]);

  // Trigger on tab focus + online events.
  useEffect(() => {
    if (!config) return;
    const onVisibility = () => {
      if (document.visibilityState === "visible") void syncNow();
    };
    const onOnline = () => void syncNow();
    const onOffline = () => setStatus("offline");
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, [config, syncNow]);

  const value = useMemo<GitSyncState>(
    () => ({
      status,
      lastSyncAt,
      lastSummary,
      errorMsg,
      config,
      syncNow,
      reloadConfig,
    }),
    [status, lastSyncAt, lastSummary, errorMsg, config, syncNow, reloadConfig],
  );

  return <GitSyncContext.Provider value={value}>{children}</GitSyncContext.Provider>;
}

/**
 * Read the current Git sync state. Returns null when called outside the
 * provider (e.g. SSR or in components mounted before RootLayout finishes).
 */
export function useGitSync(): GitSyncState | null {
  return useContext(GitSyncContext);
}
