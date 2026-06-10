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
  setFolderSyncLink,
  removeFolderSyncLink,
  type OnlineSyncConfig,
} from "./config-storage";
import { loadPendingOps, savePendingOps } from "./pendingStore";
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

  // A folder (FSA) vault id is anything NOT in the cloud registry — those carry
  // a `cloud:` prefix. When the active vault is a folder, enabling sync means
  // "dual mode": remember the room against that folder so it re-arms on every
  // open, without flipping the vault into OPFS-backed cloud mode.
  const activeFolderVaultId =
    vault?.activeVaultId && !vault.activeVaultId.startsWith("cloud:")
      ? vault.activeVaultId
      : null;

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
        epoch: "",
      });
      if (activeFolderVaultId) {
        setFolderSyncLink(activeFolderVaultId, {
          serverUrl: settings.serverUrl,
          vaultKey: settings.vaultKey,
          token: settings.token,
        });
      }
    },
    [persist, activeFolderVaultId],
  );

  const disable = useCallback(() => {
    persist({ ...loadOnlineSyncConfig(), enabled: false });
    if (activeFolderVaultId) removeFolderSyncLink(activeFolderVaultId);
  }, [persist, activeFolderVaultId]);

  // Re-sync config from localStorage when a vault becomes ready. The cloud
  // setup flow (PwaVaultSetup, which sits ABOVE this provider in the tree and
  // so can't call enable()) writes an enabled config directly to localStorage
  // right before booting the worker. Without this re-read, a cloud vault set
  // up in the current session would never connect until a full reload.
  useEffect(() => {
    if (vault?.state === "ready") {
      setConfig(loadOnlineSyncConfig());
    }
  }, [vault?.state]);

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
      epoch: config.epoch,
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
      onEpochChange: (epoch) => {
        const latest = loadOnlineSyncConfig();
        const firstContact = latest.epoch === "";
        saveOnlineSyncConfig(
          firstContact
            ? { ...latest, epoch }
            : // Server log was wiped: cursor + seeded are meaningless now.
              { ...latest, epoch, lastSeq: 0, seeded: false },
        );
      },
      pending: {
        load: () => loadPendingOps(config.vaultKey),
        save: (ops) => savePendingOps(config.vaultKey, ops),
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

    // Flush pending pushes before the tab goes away. `keepalive` lets the
    // request survive the page teardown; if it still fails, the durable
    // pending journal carries the ops to the next session.
    const onHide = () => void client.flush({ keepalive: true });
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
