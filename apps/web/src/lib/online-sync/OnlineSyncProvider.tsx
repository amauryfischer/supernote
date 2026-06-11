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
  normalizeVaultKey,
  upsertCloudVault,
  type OnlineSyncConfig,
} from "./config-storage";
import { isCloudVaultActive } from "@/lib/trpc/client";
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

  const enable = useCallback(
    (settings: { serverUrl: string; vaultKey: string; token: string }) => {
      const vaultKey = normalizeVaultKey(settings.vaultKey);
      // Changing ROOM while a cloud vault is mounted must go through the
      // full switch flow (worker teardown → db-owner bookkeeping → reset
      // boot on the new room's namespaced dir). Just rewriting the config
      // here would keep the worker mounted on the OLD room's directory and
      // apply the new room's ops into it — cross-room contamination.
      if (isCloudVaultActive()) {
        const cur = loadOnlineSyncConfig();
        const changingRoom =
          `${settings.serverUrl}|${vaultKey}` !==
          `${cur.serverUrl}|${normalizeVaultKey(cur.vaultKey)}`;
        if (changingRoom && vault?.switchToVault) {
          const entry = upsertCloudVault({
            serverUrl: settings.serverUrl,
            vaultKey,
            token: settings.token,
          });
          void vault.switchToVault(entry.id);
          return;
        }
      }
      // Changing connection target resets the cursor + seed so the new room
      // gets a fresh snapshot and replays from the start.
      persist({
        enabled: true,
        serverUrl: settings.serverUrl,
        vaultKey,
        token: settings.token,
        lastSeq: 0,
        seeded: false,
        epoch: "",
      });
    },
    [persist, vault],
  );

  const disable = useCallback(() => {
    persist({ ...loadOnlineSyncConfig(), enabled: false });
  }, [persist]);

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
    // Cursor fields come from the SOURCE OF TRUTH at construction time, not
    // from React state: PwaVaultSetup may have just reset them (DB-owner
    // mismatch at boot) AFTER this component's initial state was captured,
    // and the effect deps below intentionally exclude lastSeq/seeded/epoch —
    // a stale closure here would replay `since=<old seq>` over a freshly
    // wiped DB and mount the vault permanently blank.
    const persisted = loadOnlineSyncConfig();
    // Stale-state short-circuit: right after a vault switch, this effect can
    // run one commit before the config re-read effect above lands — building
    // a client for the PREVIOUS room with the NEW room's cursors. The
    // identity guards below would neuter it, but skipping outright avoids a
    // wasted /info probe + full replay thrown away in warnings. The imminent
    // re-render rebuilds with the right config.
    if (
      persisted.serverUrl !== config.serverUrl ||
      persisted.vaultKey !== normalizeVaultKey(config.vaultKey)
    ) {
      setStatus("disabled");
      return;
    }
    // Room binding: every callback below re-checks that the persisted config
    // still designates THIS room before touching anything. A vault switch
    // rewrites the config before React unmounts/stops this client, so a
    // late stream batch or RPC continuation from the old room must neither
    // be applied (it would be queued against the NEW room's worker and
    // drained into its DB at VAULT_READY) nor persist its cursor/seeded
    // state into the new room's config.
    // The key is canonicalised: the persisted side is normalised on save AND
    // load, while React state may hold the raw user input (e.g. a mobile
    // keyboard's auto-capitalised key) — comparing raw-to-normalised would
    // make this guard reject every single callback for the whole session.
    const boundRoom = `${config.serverUrl}|${normalizeVaultKey(config.vaultKey)}`;
    const roomStillActive = () => {
      const cur = loadOnlineSyncConfig();
      return cur.enabled && `${cur.serverUrl}|${cur.vaultKey}` === boundRoom;
    };
    const client = new OnlineSyncClient({
      serverUrl: config.serverUrl,
      vaultKey: config.vaultKey,
      token: config.token,
      clientId,
      initialSeq: persisted.lastSeq,
      seeded: persisted.seeded,
      epoch: persisted.epoch,
      applyOps: async (ops: EntityOp[]) => {
        if (!roomStillActive()) throw new Error("sync room changed");
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
        if (!roomStillActive()) throw new Error("sync room changed");
        const res = await trpcVanillaClient.sync.snapshot.query();
        return res.ops as EntityOp[];
      },
      onSeq: (seq) => {
        if (!roomStillActive()) return;
        const latest = loadOnlineSyncConfig();
        saveOnlineSyncConfig({ ...latest, lastSeq: seq });
      },
      onSeeded: () => {
        if (!roomStillActive()) return;
        const latest = loadOnlineSyncConfig();
        saveOnlineSyncConfig({ ...latest, seeded: true });
      },
      onEpochChange: (epoch) => {
        if (!roomStillActive()) return;
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
        const m = msg as { op?: EntityOp; sourceVaultId?: string | null };
        // Les entités montées (provenance ≠ null) ne vont JAMAIS dans le salon
        // du père — le MountSyncManager les route vers leur salon d'origine.
        if (m.sourceVaultId) return;
        if (m.op) client.enqueue([m.op]);
      }
    });

    // Flush pending pushes before the tab goes away. `keepalive` lets the
    // request survive the page teardown; if it still fails, the durable
    // pending journal carries the ops to the next session.
    const onHide = () => void client.flush({ keepalive: true });
    window.addEventListener("pagehide", onHide);
    document.addEventListener("visibilitychange", onHide);

    // Vault switches terminate the worker SYNCHRONOUSLY (and then rewrite
    // the sync config) long before React commits the state change that runs
    // this effect's cleanup. Stop the client the moment the worker dies so
    // no further stream batch is dispatched during that window.
    const onUnready = () => client.stop();
    window.addEventListener("supernote:vault-unready", onUnready);

    return () => {
      unsub();
      window.removeEventListener("pagehide", onHide);
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("supernote:vault-unready", onUnready);
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
