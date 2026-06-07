"use client";

/**
 * OnlineSyncProvider — mounts the realtime online-sync client and bridges it
 * to the vault worker.
 *
 * Lives next to {@link GitSyncProvider} at the root of the React tree (inside
 * PwaVaultSetup so it only runs once a vault is open). When the user has
 * enabled online sync (see /parametres > Synchronisation), it:
 *
 *   - subscribes to the worker's `ENTITY_CHANGE` broadcasts and forwards each
 *     local op to the {@link OnlineSyncClient},
 *   - applies peers' ops by calling the worker's `sync.applyOps` procedure
 *     (which deliberately does NOT re-emit ENTITY_CHANGE — no echo loop),
 *   - seeds the server once via `sync.snapshot`,
 *   - exposes live status + config to the settings UI through context.
 *
 * Disabled vaults pay zero cost: no client, no stream, no listeners.
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
import type { EntityOp } from "@supernote/sync";
import { useVault } from "@/lib/pwa/PwaVaultSetup";
import { onWorkerMessage } from "@/lib/trpc/browser-link";
import { trpcVanillaClient } from "@/lib/trpc/client";
import {
  loadOnlineSyncConfig,
  saveOnlineSyncConfig,
  getOrCreateClientId,
  type OnlineSyncConfig,
} from "./config-storage";
import { OnlineSyncClient, type OnlineSyncStatus } from "./client";

export interface OnlineSyncState {
  status: OnlineSyncStatus;
  config: OnlineSyncConfig;
  lastError: string | null;
  /** Turn sync on with the given connection settings (persists + connects). */
  enable: (settings: { serverUrl: string; vaultKey: string; token: string }) => void;
  /** Turn sync off (persists + disconnects). */
  disable: () => void;
}

const OnlineSyncContext = createContext<OnlineSyncState | null>(null);

export function OnlineSyncProvider({ children }: { children: React.ReactNode }) {
  const vault = useVault();
  const [config, setConfig] = useState<OnlineSyncConfig>(() => loadOnlineSyncConfig());
  const [status, setStatus] = useState<OnlineSyncStatus>("disabled");
  const [lastError, setLastError] = useState<string | null>(null);
  const clientRef = useRef<OnlineSyncClient | null>(null);

  // Persist + apply config changes from outside (settings UI).
  const persist = useCallback((next: OnlineSyncConfig) => {
    saveOnlineSyncConfig(next);
    setConfig(next);
  }, []);

  const enable = useCallback(
    (settings: { serverUrl: string; vaultKey: string; token: string }) => {
      // Changing connection target resets the cursor + seed so the new room
      // gets a fresh snapshot and replays from the start.
      persist({
        enabled: true,
        serverUrl: settings.serverUrl,
        vaultKey: settings.vaultKey,
        token: settings.token,
        lastSeq: 0,
        seeded: false,
      });
    },
    [persist],
  );

  const disable = useCallback(() => {
    persist({ ...loadOnlineSyncConfig(), enabled: false });
  }, [persist]);

  // (Re)build the client whenever the effective config or vault readiness
  // changes. The client owns the stream + push lifecycle; we just feed it ops.
  useEffect(() => {
    // Tear down any previous client first.
    clientRef.current?.stop();
    clientRef.current = null;

    const ready = vault?.state === "ready";
    if (!ready || !config.enabled || !config.vaultKey) {
      setStatus("disabled");
      return;
    }

    const clientId = getOrCreateClientId();
    const client = new OnlineSyncClient({
      serverUrl: config.serverUrl,
      vaultKey: config.vaultKey,
      token: config.token,
      clientId,
      initialSeq: config.lastSeq,
      seeded: config.seeded,
      applyOps: async (ops: EntityOp[]) => {
        await trpcVanillaClient.sync.applyOps.mutate({ ops });
        // Nudge TanStack Query so the UI reflects peers' changes immediately.
        if (typeof window !== "undefined") {
          window.dispatchEvent(
            new CustomEvent("supernote:index-progress", {
              detail: { indexed: ops.length, total: ops.length },
            }),
          );
        }
      },
      getSnapshot: async () => {
        const res = await trpcVanillaClient.sync.snapshot.query();
        return res.ops as EntityOp[];
      },
      onSeq: (seq) => {
        const latest = loadOnlineSyncConfig();
        saveOnlineSyncConfig({ ...latest, lastSeq: seq });
      },
      onSeeded: () => {
        const latest = loadOnlineSyncConfig();
        saveOnlineSyncConfig({ ...latest, seeded: true });
      },
      onStatus: (s, detail) => {
        setStatus(s);
        setLastError(detail?.error ?? null);
      },
    });
    clientRef.current = client;
    void client.start();

    // Forward local entity mutations from the worker to the client.
    const unsub = onWorkerMessage((msg) => {
      if (
        msg &&
        typeof msg === "object" &&
        (msg as { type?: string }).type === "ENTITY_CHANGE"
      ) {
        const op = (msg as { op?: EntityOp }).op;
        if (op) client.enqueue([op]);
      }
    });

    // Flush pending pushes before the tab goes away.
    const onHide = () => void client.flush();
    window.addEventListener("pagehide", onHide);
    document.addEventListener("visibilitychange", onHide);

    return () => {
      unsub();
      window.removeEventListener("pagehide", onHide);
      document.removeEventListener("visibilitychange", onHide);
      client.stop();
      clientRef.current = null;
    };
    // We intentionally re-init on the identity of these fields.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    vault?.state,
    config.enabled,
    config.serverUrl,
    config.vaultKey,
    config.token,
  ]);

  const value = useMemo<OnlineSyncState>(
    () => ({ status, config, lastError, enable, disable }),
    [status, config, lastError, enable, disable],
  );

  return <OnlineSyncContext.Provider value={value}>{children}</OnlineSyncContext.Provider>;
}

/** Read the online-sync state. Null outside the provider. */
export function useOnlineSync(): OnlineSyncState | null {
  return useContext(OnlineSyncContext);
}
