"use client";

/**
 * PwaVaultSetup — first-launch modal for PWA browser mode.
 *
 * Shows when:
 *   - Browser supports FSA (showDirectoryPicker)
 *   - Not running inside Electron
 *   - No vault handle is persisted in IndexedDB (or permission was revoked)
 *
 * Flow:
 *   "Choisir un dossier" → showDirectoryPicker() → save handle → init worker
 *   "Continuer sans dossier" → degraded localStorage mode (persisted in localStorage)
 *
 * The hook state is also exposed via VaultContext so the rest of the chrome
 * (sidebar header, settings, etc.) can read the active vault name and
 * trigger a re-pick without duplicating worker bootstrap logic.
 *
 * IMPORTANT: This component ALWAYS returns the same React tree shape
 * (`<>{children}{showOverlay && <PwaOverlay/>}</>`) so children never
 * unmount/remount on state transitions. Without this, every navigation
 * would re-fire the init effect and trigger a worker re-INIT, which
 * could lose unflushed mutations.
 */

import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from "react";
import { Button } from "@heroui/react";
import {
  saveVaultHandle,
  loadVaultHandle,
  verifyHandlePermission,
  listVaults,
  getVaultEntry,
  upsertVaultEntry,
  removeVaultEntry,
  getActiveVaultId,
  setActiveVaultId,
  type VaultEntry,
} from "@/lib/vault-worker/vault-handle-storage";
import { initWorkerVault, setWorkerReady, flushVaultWorker, terminateVaultWorker, isWorkerReady, getLastVaultReady } from "@/lib/trpc/browser-link";
import { isBrowserPwaMode, isCloudCapable, isCloudVaultActive, CLOUD_VAULT_KEY } from "@/lib/trpc/client";
import { cloneIntoVault, initInVault, isLinked } from "@/lib/git/github-sync";
import { saveGitConfig } from "@/lib/git/config-storage";
import {
  saveOnlineSyncConfig,
  loadOnlineSyncConfig,
  DEFAULT_ONLINE_SYNC_CONFIG,
  normalizeVaultKey,
  listCloudVaults,
  getCloudVault,
  upsertCloudVault,
  removeCloudVault,
  cloudVaultId,
  archiveActiveSyncConfig,
  restoreFolderSyncConfig,
  removeVaultSyncBinding,
} from "@/lib/online-sync/config-storage";
import { cloudRoomSlug } from "@/lib/online-sync/room-id";
import { clearPendingOps } from "@/lib/online-sync/pendingStore";

const DEGRADED_STORAGE_KEY = "supernote.degraded";

/**
 * OPFS scratch directory that backs a cloud vault. A real (OPFS-resident)
 * FileSystemDirectoryHandle, so the worker treats it exactly like a folder
 * vault — but it needs no user picker and works on every OPFS-capable engine
 * (Android Chrome, Safari, Firefox), not just FSA-folder Chromium desktop.
 */
const CLOUD_OPFS_DIR = "supernote-cloud";

/**
 * Room files are namespaced per (server, room key) pair under
 * `supernote-cloud/rooms/<slug>/` so two cloud rooms NEVER share a directory.
 * Switching rooms therefore cannot leak files across rooms (the background
 * reindex only ever sees the mounted room's own files), and the previous
 * room's local-only artefacts — canvas .excalidraw files are NOT transported
 * by the sync op-log — survive untouched for its next mount.
 *
 * Pre-namespace builds stored the active room's files directly at the
 * `supernote-cloud/` root. Those are deliberately left in place (quarantined):
 * their room of origin is not recorded anywhere, so any automatic migration
 * could attribute them to the wrong room and replicate them into its server
 * op-log — the exact cross-room contamination this layout exists to prevent.
 */
const CLOUD_ROOMS_DIR = "rooms";
const CLOUD_META_DIR = ".supernote";
const CLOUD_DB_OWNER_FILE = "db-owner.json";

/**
 * How long the "loading" overlay tolerates total silence (no VAULT_READY and no
 * indexing progress) before failing to a retryable error instead of hanging.
 * Re-armed on every index-progress tick, so it only fires on a genuinely stuck
 * boot, not a slow-but-alive reindex.
 */
const VAULT_BOOT_IDLE_TIMEOUT_MS = 30_000;

async function getCloudBaseDir(): Promise<FileSystemDirectoryHandle> {
  const root = await navigator.storage.getDirectory();
  // Un coffre cloud vit en OPFS best-effort : le navigateur peut l'évincer sous
  // pression disque, et canvas/pièces jointes ne sont PAS transportés par l'op-log
  // serveur (perte définitive). persist() rend le stockage non-évictable.
  // Idempotent, best-effort, [Exposed=Window] donc appelé ici (main thread) et
  // pas dans le worker ; un échec/refus ne doit rien bloquer.
  try {
    await navigator.storage.persist?.();
  } catch {
    /* persist() indisponible ou refusé — best-effort */
  }
  return root.getDirectoryHandle(CLOUD_OPFS_DIR, { create: true });
}

async function getCloudVaultHandle(cloudId: string): Promise<FileSystemDirectoryHandle> {
  const base = await getCloudBaseDir();
  const rooms = await base.getDirectoryHandle(CLOUD_ROOMS_DIR, { create: true });
  return rooms.getDirectoryHandle(cloudRoomSlug(cloudId), { create: true });
}

/**
 * The SAH-pool SQLite DB is global to the origin (one `/index.db` for every
 * vault) while room FILES are namespaced — so the DB needs an ownership
 * marker: `supernote-cloud/.supernote/db-owner.json` records which room the
 * current DB was built for. Checked at boot; on mismatch the worker is asked
 * to reset the DB (resetStorage), which is then rebuilt from the room's own
 * files (reindex) + the server op-log (replay). No files are ever deleted.
 *
 * Written only AFTER the fresh worker reports VAULT_READY, so its presence
 * guarantees the DB was (re)built under that exact room. An interrupted
 * switch leaves the previous owner (or none) behind → next boot self-heals.
 */
async function readDbOwner(): Promise<string | null> {
  try {
    const base = await getCloudBaseDir();
    const meta = await base.getDirectoryHandle(CLOUD_META_DIR);
    const file = await meta.getFileHandle(CLOUD_DB_OWNER_FILE);
    const text = await (await file.getFile()).text();
    const parsed = JSON.parse(text) as { id?: unknown };
    return typeof parsed.id === "string" && parsed.id ? parsed.id : null;
  } catch {
    return null;
  }
}

async function writeDbOwner(cloudId: string): Promise<void> {
  const base = await getCloudBaseDir();
  const meta = await base.getDirectoryHandle(CLOUD_META_DIR, { create: true });
  const file = await meta.getFileHandle(CLOUD_DB_OWNER_FILE, { create: true });
  const writable = await file.createWritable();
  await writable.write(JSON.stringify({ id: cloudId }));
  await writable.close();
}

/**
 * Invalidate the DB ownership marker. Called when the (origin-global) SAH
 * DB stops belonging to a cloud room — i.e. when a folder/git vault takes
 * over the pool. Without this, a later cloud boot whose config happens to
 * name the still-recorded room would skip its reset and mount the FOLDER
 * vault's DB under the room's label. Absent marker = always reset = safe.
 */
async function clearDbOwner(): Promise<void> {
  try {
    const base = await getCloudBaseDir();
    const meta = await base.getDirectoryHandle(CLOUD_META_DIR);
    await meta.removeEntry(CLOUD_DB_OWNER_FILE);
  } catch {
    /* absent — nothing to invalidate */
  }
}

/** Remove a room's namespaced files (explicit user "forget" only). */
async function deleteCloudRoom(cloudId: string): Promise<void> {
  try {
    const base = await getCloudBaseDir();
    const rooms = await base.getDirectoryHandle(CLOUD_ROOMS_DIR);
    await rooms.removeEntry(cloudRoomSlug(cloudId), { recursive: true });
  } catch {
    /* absent or locked — nothing to clean / next forget retries */
  }
}

/**
 * Cloud-boot bookkeeping. Each cloud boot records its generation + the room
 * it booted FOR; the db-owner write scheduled on VAULT_READY stamps the
 * RECORDED room (not the config re-read at ready time, which a concurrent
 * switch may already have rewritten) and bails when a newer boot started.
 * Writes are serialised through a promise chain with the generation
 * re-checked inside the chain, so the last write always reflects the most
 * recent boot even when two readies race.
 */
let cloudBootGeneration = 0;
let lastCloudBoot: { gen: number; cloudId: string } | null = null;
let dbOwnerWriteChain: Promise<void> = Promise.resolve();

function recordCloudBoot(cloudId: string): void {
  cloudBootGeneration++;
  lastCloudBoot = { gen: cloudBootGeneration, cloudId };
}

function scheduleDbOwnerWrite(boot: { gen: number; cloudId: string }): void {
  dbOwnerWriteChain = dbOwnerWriteChain
    .then(async () => {
      if (boot.gen !== cloudBootGeneration) return; // a newer boot took over
      await writeDbOwner(boot.cloudId);
    })
    .catch((err) => {
      // Best-effort: without the marker the next boot resets the DB and
      // rebuilds from files + server replay — always safe.
      console.warn("[pwa-vault] db-owner write failed", err);
    });
}

type SetupState =
  | "idle"        // Checking for existing handle
  | "checking"    // Verifying stored handle permission
  | "ready"       // Vault is initialized
  | "prompt"      // Welcome — choose between local folder and git repo
  | "git-form"    // Git setup form (URL + PAT + folder)
  | "cloud-form"  // Online-sync setup form (server + room key + token)
  | "picking"     // showDirectoryPicker in progress
  | "cloning"     // git clone in progress
  | "loading"     // Worker initializing
  | "error"       // Init failed
  | "degraded";   // User chose localStorage mode

export interface GitSetupArgs {
  /** HTTPS clone URL — `https://github.com/me/notes.git`. */
  url: string;
  /** Personal Access Token — optional for public repos. */
  token: string;
  /** Branch to track. Defaults to `main`. */
  ref?: string;
  /**
   * Behaviour when the picked folder is not empty:
   *   - "clone-into-empty": refuse, force the user to pick an empty folder
   *   - "init-existing": skip clone, init `.git/`, link remote, push as
   *     initial commit on next sync
   */
  mode: "clone-into-empty" | "init-existing";
}

export interface CloudSetupArgs {
  /** Sync server base URL. Empty = same origin as the app. */
  serverUrl: string;
  /** Room key — every device sharing this key + server replicates one vault. */
  vaultKey: string;
  /** Shared secret, required only when the server sets `SYNC_TOKEN`. */
  token: string;
}

/** Lightweight projection of a known vault exposed to UI consumers. */
export interface RecentVault {
  id: string;
  name: string;
  lastOpenedAt: number;
  /** Storage backend behind this vault — drives the switcher icon. */
  kind: "folder" | "cloud";
  /** Cloud entries only: sync server ("" = same origin), for disambiguation. */
  serverUrl?: string;
}

interface VaultContextValue {
  state: SetupState;
  errorMsg: string | null;
  vaultName: string | null;
  /** Open the FSA folder picker and re-initialise the worker with the chosen folder. */
  pickFolder: () => Promise<void>;
  /** Open the Git setup form. */
  startGitFlow: () => void;
  /** Cancel the Git setup form and return to the welcome screen. */
  cancelGitFlow: () => void;
  /** Run the Git flow: pick folder, clone (or init), persist config, init worker. */
  setupGitVault: (args: GitSetupArgs) => Promise<void>;
  /** Open the cloud (online-sync) setup form. */
  startCloudFlow: () => void;
  /** Cancel the cloud setup form and return to the welcome screen. */
  cancelCloudFlow: () => void;
  /**
   * Run the cloud flow: probe the server, persist the online-sync config,
   * boot an OPFS-backed worker vault. The OnlineSyncProvider then seeds it
   * from the server's op-log — pulling the vault from your other devices.
   */
  setupCloudVault: (args: CloudSetupArgs) => Promise<void>;
  /** Continue without a vault folder (localStorage degraded mode). */
  skipToDegraded: () => void;
  /** True only in PWA mode (FSA folder picker available). */
  isPwa: boolean;
  /** True when a cloud vault is possible (OPFS + Worker — most engines). */
  canCloud: boolean;
  /** Known vaults, freshest first. Repopulated on every switch / pick. */
  recentVaults: RecentVault[];
  /** Id of the vault currently mounted by the worker, or null. */
  activeVaultId: string | null;
  /**
   * Activate one of the {@link recentVaults} by id. Re-requests permission
   * if needed; on success the worker is re-initialised against the new
   * folder. Resolves once the worker emits `VAULT_READY` (or rejects).
   */
  switchToVault: (id: string) => Promise<void>;
  /** Remove a vault from the recents registry. The active vault cannot be removed. */
  forgetVault: (id: string) => Promise<void>;
}

const VaultContext = createContext<VaultContextValue | null>(null);

/**
 * Read the current vault state from anywhere in the tree.
 * Returns null when called outside the PwaVaultSetup provider (e.g. SSR or
 * Electron-only paths) so callers can render a graceful fallback.
 */
export function useVault(): VaultContextValue | null {
  return useContext(VaultContext);
}

export function usePwaVaultSetup(): VaultContextValue {
  const [state, setState] = useState<SetupState>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [vaultName, setVaultName] = useState<string | null>(null);
  const [recentVaults, setRecentVaults] = useState<RecentVault[]>([]);
  const [activeVaultId, setActiveVaultIdState] = useState<string | null>(null);

  // FSA folder picker available (Chromium desktop) → folder/git vaults.
  const isPwa = isBrowserPwaMode();
  // OPFS + Worker available (almost every modern engine, phones included) →
  // a cloud vault is possible even without the folder picker.
  const canCloud = isCloudCapable();

  // Refresh the in-memory recents projection. Merges two registries: FSA folder
  // vaults (IndexedDB) and cloud vaults (localStorage). Cheap (≤ a handful of
  // entries) so we call it from any code path that mutates either registry.
  const refreshRecents = useCallback(async () => {
    try {
      const [folderEntries, folderActive] = await Promise.all([
        listVaults(),
        getActiveVaultId(),
      ]);
      const folderRecents: RecentVault[] = folderEntries.map((e) => ({
        id: e.id,
        name: e.name,
        lastOpenedAt: e.lastOpenedAt,
        kind: "folder",
      }));
      const cloudRecents: RecentVault[] = listCloudVaults().map((e) => ({
        id: e.id,
        name: e.vaultKey,
        lastOpenedAt: e.lastOpenedAt,
        kind: "cloud",
        serverUrl: e.serverUrl,
      }));
      const merged = [...folderRecents, ...cloudRecents].sort(
        (a, b) => b.lastOpenedAt - a.lastOpenedAt,
      );
      // When a cloud vault is mounted, the active id is the cloud entry matching
      // the live online-sync config — NOT the (now stale) FSA active id.
      let active: string | null = folderActive;
      if (isCloudVaultActive()) {
        const cfg = loadOnlineSyncConfig();
        if (cfg.vaultKey) active = cloudVaultId(cfg.serverUrl, cfg.vaultKey);
      }
      setRecentVaults(merged);
      setActiveVaultIdState(active);
    } catch (err) {
      console.warn("[pwa-vault] refreshRecents failed", err);
    }
  }, []);

  // Guard so the bootstrap effect runs at most once per page load.
  // Without this, the effect would re-fire on every navigation that
  // happens to remount this component (e.g. a parent boundary changing
  // its tree shape), re-sending INIT_VAULT and racing with the in-flight
  // mutation persistence.
  const initStartedRef = useRef(false);

  useEffect(() => {
    // Browser can host neither a folder vault nor a cloud vault → the app
    // runs on the degraded localStorage mock; nothing to bootstrap.
    if (!isPwa && !canCloud) { setState("ready"); return; }
    if (initStartedRef.current) return;
    initStartedRef.current = true;

    const ls = typeof window !== "undefined" ? window.localStorage : null;

    // Cloud vault chosen on a previous visit → re-open the OPFS-backed worker.
    // The OnlineSyncProvider reconnects from the persisted config and replays
    // the op-log, so the vault is rehydrated from the server.
    if (ls?.getItem(CLOUD_VAULT_KEY) === "1") {
      setState("loading");
      // Make sure the active cloud config is in the registry so the switcher
      // lists it (covers users who set up a cloud vault before the registry
      // existed — they'd otherwise see no cloud entry to switch back to).
      const cfg = loadOnlineSyncConfig();
      if (cfg.vaultKey) {
        upsertCloudVault({ serverUrl: cfg.serverUrl, vaultKey: cfg.vaultKey, token: cfg.token });
      }
      void refreshRecents();
      void (async () => {
        try {
          if (!cfg.vaultKey) {
            throw new Error("configuration cloud incomplète (clé de salon absente)");
          }
          const cloudId = cloudVaultId(cfg.serverUrl, cfg.vaultKey);
          recordCloudBoot(cloudId);
          const handle = await getCloudVaultHandle(cloudId);
          // DB-ownership check: the SAH-pool DB is global while room files
          // are namespaced. After an interrupted switch (or on a pre-marker
          // build) the DB may still hold ANOTHER room's entities — mounting
          // it as-is shows room A's notes under room B's label AND seeds
          // them into B's server op-log. On mismatch, reset the DB; it is
          // rebuilt from this room's own files + the server replay. No
          // files are deleted.
          const owner = await readDbOwner();
          const dbStale = owner !== cloudId;
          if (dbStale) {
            console.warn(
              "[pwa-vault] cloud DB owner mismatch — resetting local index",
              { owner, cloudId },
            );
            // The local DB restarts empty: the replay cursor must restart
            // from 0 and the seed must re-run (after the reindex re-adopts
            // this room's own files), otherwise the room mounts blank and
            // stays blank.
            saveOnlineSyncConfig({ ...cfg, lastSeq: 0, seeded: false, epoch: "" });
          }
          startWorker(handle, { cloud: true, resetStorage: dbStale });
        } catch (err) {
          setErrorMsg(`Impossible d'ouvrir le coffre cloud : ${String(err)}`);
          setState("error");
        }
      })();
      return;
    }

    // If the user previously chose degraded mode, honour that decision
    // immediately and skip the picker entirely on every subsequent visit.
    if (ls?.getItem(DEGRADED_STORAGE_KEY) === "1") {
      setState("degraded");
      return;
    }

    // No FSA folder picker (Android Chrome, Safari, Firefox) → only the cloud
    // (or degraded) path is possible: go straight to the welcome screen, which
    // surfaces just the cloud card.
    if (!isPwa) { setState("prompt"); return; }

    setState("checking");
    void (async () => {
      const handle = await loadVaultHandle().catch(() => null);
      // Seed the recents projection regardless of permission outcome so the
      // sidebar switcher is populated as soon as the chrome mounts.
      void refreshRecents();
      if (!handle) { setState("prompt"); return; }

      const granted = await verifyHandlePermission(handle, false);
      if (granted) {
        setState("loading");
        startWorker(handle);
      } else {
        // Need to re-ask permission — show the prompt with re-auth option
        setState("prompt");
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPwa, canCloud]);

  useEffect(() => {
    if (state !== "loading") return;
    if (typeof window === "undefined") return;
    const onReady = (ev?: Event) => {
      const detail = (ev as CustomEvent | undefined)?.detail as
        | { vaultName?: string }
        | undefined;
      const name = detail?.vaultName ?? getLastVaultReady()?.vaultName ?? null;
      if (name) setVaultName(name);
      // Cloud vault finished mounting → stamp the DB ownership marker. Only
      // now is it safe: VAULT_READY proves the worker ran (and, on a switch,
      // completed its resetStorage wipe) for the room this boot was started
      // FOR — which is why the recorded boot identity is stamped, not the
      // config re-read here (a concurrent switch may have rewritten it).
      if (isCloudVaultActive() && lastCloudBoot) {
        scheduleDbOwnerWrite(lastCloudBoot);
      }
      setState("ready");
      // The worker just finished mounting a handle — make sure the recents
      // list and active id reflect that (covers the bootstrap path where the
      // registry hadn't been touched yet).
      void refreshRecents();
    };
    const onError = (ev?: Event) => {
      const detail = (ev as CustomEvent | undefined)?.detail as
        | { error?: string }
        | undefined;
      setErrorMsg(detail?.error ?? "Erreur d'initialisation du coffre.");
      setState("error");
    };
    // Listen on the worker-instance-agnostic window events dispatched by the
    // browser-link singleton, NOT on the worker port directly. A vault switch
    // (e.g. choosing "Cloud") terminates the worker a port-bound listener was
    // attached to and spawns a fresh one — a direct listener would never see
    // the new worker's VAULT_READY, leaving the overlay stuck on "Ouverture du
    // vault…" forever.
    window.addEventListener("supernote:vault-ready", onReady);
    window.addEventListener("supernote:vault-error", onError);

    // Watchdog: a boot that never emits VAULT_READY (worker died mid-switch, a
    // dropped message, or an OPFS lock) would otherwise pin this overlay on
    // "Ouverture du vault…" forever. Fail to a retryable error after a stretch
    // of silence instead. Indexing progress re-arms it, so a legitimately long
    // reindex of a large vault keeps the overlay alive rather than tripping it.
    let watchdog = 0;
    const armWatchdog = () => {
      window.clearTimeout(watchdog);
      watchdog = window.setTimeout(() => {
        if (isWorkerReady()) return;
        setErrorMsg(
          "L'ouverture du coffre n'a pas répondu (le worker n'a pas démarré). Réessayez.",
        );
        setState("error");
      }, VAULT_BOOT_IDLE_TIMEOUT_MS);
    };
    const onProgress = () => armWatchdog();
    window.addEventListener("supernote:index-progress", onProgress);
    armWatchdog();

    // Cover the race where VAULT_READY fired before this listener attached
    // (the window event does not replay): if the worker is already up, resolve
    // immediately from the stashed identity.
    if (isWorkerReady()) onReady();
    return () => {
      window.clearTimeout(watchdog);
      window.removeEventListener("supernote:vault-ready", onReady);
      window.removeEventListener("supernote:vault-error", onError);
      window.removeEventListener("supernote:index-progress", onProgress);
    };
  }, [state]);

  // Flush any pending worker writes when the page is hidden / unloaded
  // so a navigation away (or tab close) does not lose the in-flight
  // debounced persist. Registered once.
  //
  // We bind to:
  //   - `beforeunload` + `pagehide` (tab close / hard nav)
  //   - `freeze` (mobile / Chromium tab discards)
  //   - `visibilitychange` (tab backgrounded — fires earlier than pagehide
  //     on mobile, where pagehide may never fire if the OS kills the tab)
  // All listeners are removed in the cleanup so we don't leak handlers
  // when this component remounts in dev/HMR.
  useEffect(() => {
    if (!isPwa) return;
    const flush = () => { void flushVaultWorker(); };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flush();
    };
    window.addEventListener("beforeunload", flush);
    window.addEventListener("pagehide", flush);
    window.addEventListener("freeze", flush);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("beforeunload", flush);
      window.removeEventListener("pagehide", flush);
      window.removeEventListener("freeze", flush);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [isPwa]);

  const pickFolder = useCallback(async () => {
    setState("picking");
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const handle = await (window as any).showDirectoryPicker({
        id: "supernote-vault",
        mode: "readwrite",
        startIn: "documents",
      }) as FileSystemDirectoryHandle;
      // If the user picked a DIFFERENT folder than what's currently linked,
      // wipe the OPFS-cached SQLite index — otherwise the worker would fall
      // back to it and resurrect the previous vault's data in the new
      // folder. Same-folder re-pick (e.g. re-authorising permission after
      // a session expiry) keeps the cache.
      //
      // Coming FROM a cloud vault always counts as different: the persisted
      // folder handle was never updated by the cloud flows, so a same-folder
      // comparison would keep the CLOUD room's DB (the SAH pool is global)
      // and mount — then mirror to disk — the room's notes into this folder.
      const wasCloud = isCloudVaultActive();
      const previous = await loadVaultHandle().catch(() => null);
      const isDifferentFolder =
        wasCloud ||
        !previous ||
        !(await previous.isSameEntry(handle).catch(() => false));
      // Archive the outgoing vault's sync config under its own id before we
      // repoint the active handle (per-vault sync).
      archiveActiveSyncConfig(await currentActiveVaultId());
      if (isDifferentFolder) {
        // Kill the current worker so its pending RPCs don't land on the new
        // vault. The OPFS wipe itself is performed by the FRESH worker via
        // the SAH-pool unlink API (see InitVaultMessage.resetStorage) —
        // doing it on the main thread is unreliable because the previous
        // worker's SAH handles are released asynchronously by the browser.
        terminateVaultWorker();
      }
      await saveVaultHandle(handle);
      // Picking a folder explicitly opts out of degraded mode.
      if (typeof window !== "undefined") {
        // Picking a folder / git repo opts out of degraded mode and drops the
        // cloud marker (the config swap below sets the right sync state).
        window.localStorage.removeItem(DEGRADED_STORAGE_KEY);
        leaveCloudMode();
      }
      // Adopt the picked folder's own remembered sync config — re-picking a
      // folder that had sync reconnects it; a never-synced folder stays off.
      const pickedId = await getActiveVaultId();
      if (pickedId) restoreFolderSyncConfig(pickedId);
      else saveOnlineSyncConfig({ ...DEFAULT_ONLINE_SYNC_CONFIG });
      setWorkerReady(false);
      setVaultName(null);
      setState("loading");
      void refreshRecents();
      startWorker(handle, { resetStorage: isDifferentFolder });
    } catch (err) {
      // User cancelled
      if ((err as Error).name === "AbortError") {
        setState((prev) => (prev === "picking" ? "prompt" : prev));
      } else {
        setErrorMsg(String(err));
        setState("error");
      }
    }
  }, []);

  const skipToDegraded = useCallback(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(DEGRADED_STORAGE_KEY, "1");
      window.localStorage.removeItem(CLOUD_VAULT_KEY);
    }
    setState("degraded");
  }, []);

  const startGitFlow = useCallback(() => {
    setErrorMsg(null);
    setState("git-form");
  }, []);

  const cancelGitFlow = useCallback(() => {
    setErrorMsg(null);
    setState("prompt");
  }, []);

  const startCloudFlow = useCallback(() => {
    setErrorMsg(null);
    setState("cloud-form");
  }, []);

  const cancelCloudFlow = useCallback(() => {
    setErrorMsg(null);
    setState("prompt");
  }, []);

  const setupCloudVault = useCallback(async (args: CloudSetupArgs) => {
    setErrorMsg(null);
    const serverUrl = args.serverUrl.trim().replace(/\/+$/, "");
    // Case-folded so a phone keyboard's auto-capitalisation can't fork the pair
    // into a separate vault (see normalizeVaultKey).
    const vaultKey = normalizeVaultKey(args.vaultKey);
    const token = args.token.trim();
    if (!vaultKey) {
      setErrorMsg("Une clé de salon est requise.");
      setState("cloud-form");
      return;
    }

    // Probe the server first so the user gets a clear, immediate error rather
    // than a vault that boots then silently fails to sync. `/api/sync/info` is
    // unauthenticated and reports whether a database is configured.
    setState("loading");
    try {
      const res = await fetch(`${serverUrl}/api/sync/info`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const info = (await res.json()) as {
        enabled?: boolean;
        requiresToken?: boolean;
      };
      if (!info.enabled) {
        setErrorMsg(
          "Le serveur n'a pas de base de données configurée — la synchronisation en ligne y est indisponible.",
        );
        setState("cloud-form");
        return;
      }
      if (info.requiresToken && !token) {
        setErrorMsg("Ce serveur exige un jeton partagé.");
        setState("cloud-form");
        return;
      }
    } catch (err) {
      setErrorMsg(
        `Serveur de synchronisation injoignable : ${(err as Error).message}. Vérifiez l'URL.`,
      );
      setState("cloud-form");
      return;
    }

    // Stash the outgoing vault's sync config under its own id (before the cloud
    // marker flips currentActiveVaultId to the new room) so returning to it
    // restores its own connection.
    archiveActiveSyncConfig(await currentActiveVaultId());

    // Tear down the current worker FIRST. terminateVaultWorker dispatches
    // "supernote:vault-unready", which the OnlineSyncProvider listens to for
    // a SYNCHRONOUS client stop — the previous room's sync client must be
    // dead BEFORE its config is overwritten below, or its in-flight stream
    // batches would be applied/queued against the new room's worker and its
    // late onSeq callbacks would poison the new room's cursor.
    setWorkerReady(false);
    setVaultName(null);
    terminateVaultWorker();

    if (typeof window !== "undefined") {
      // Cloud marker BEFORE the enabled config: if the tab dies between these
      // two writes, marker-without-config boots the cloud path and fails safe
      // (previous or empty config, consistent with the previous owner) —
      // whereas enabled-config-without-marker would mount the FOLDER vault
      // and seed its contents into the new room.
      window.localStorage.setItem(CLOUD_VAULT_KEY, "1");
      window.localStorage.removeItem(DEGRADED_STORAGE_KEY);
    }
    // Persist the online-sync config (enabled) BEFORE the worker boots, so the
    // OnlineSyncProvider — which mounts inside this component once the vault is
    // ready — reads it and connects immediately, seeding from the server.
    saveOnlineSyncConfig({
      ...DEFAULT_ONLINE_SYNC_CONFIG,
      enabled: true,
      serverUrl,
      vaultKey,
      token,
    });
    // Remember this room so it shows up in the switcher alongside other vaults.
    upsertCloudVault({ serverUrl, vaultKey, token });

    try {
      // Boot the room's own namespaced OPFS dir with resetStorage: the
      // SAH-pool DB is global and may still belong to a previous vault. Room
      // files are per-room, so nothing is purged — the reindex only ever
      // sees this room's files. The user's on-disk folder files (if any)
      // live in FSA, untouched.
      const cloudId = cloudVaultId(serverUrl, vaultKey);
      recordCloudBoot(cloudId);
      const handle = await getCloudVaultHandle(cloudId);
      setState("loading");
      startWorker(handle, { cloud: true, resetStorage: true });
    } catch (err) {
      setErrorMsg(`Impossible d'initialiser le coffre cloud : ${String(err)}`);
      setState("error");
    }
  }, []);

  const setupGitVault = useCallback(async (args: GitSetupArgs) => {
    setErrorMsg(null);
    setState("picking");
    let handle: FileSystemDirectoryHandle;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      handle = await (window as any).showDirectoryPicker({
        id: "supernote-vault",
        mode: "readwrite",
        startIn: "documents",
      }) as FileSystemDirectoryHandle;
    } catch (err) {
      if ((err as Error).name === "AbortError") {
        setState("git-form");
        return;
      }
      setErrorMsg(String(err));
      setState("error");
      return;
    }

    setState("cloning");
    let step: string = "init";
    let initialHeadSha: string | null = null;
    // Coming FROM a cloud vault always forces a worker teardown + DB reset:
    // the SAH pool still holds the cloud room's DB, and mounting it over the
    // git folder would mirror the room's notes into the user's repo (then
    // potentially commit/push them). Same rationale as pickFolder/switchToVault.
    const wasCloud = isCloudVaultActive();
    try {
      if (wasCloud) terminateVaultWorker();
      step = "check-linked";
      const alreadyLinked = await isLinked(handle);
      if (alreadyLinked) {
        // No-op — config is refreshed below.
      } else if (args.mode === "clone-into-empty") {
        step = "clear-opfs";
        // Clone-into-empty creates a fresh vault — kill the current worker
        // and let the new one wipe OPFS via the SAH pool (see resetStorage
        // below). Main-thread OPFS removal is unreliable because the prior
        // worker's SAH handles release asynchronously.
        terminateVaultWorker();
        step = "clone";
        const cloneResult = await cloneIntoVault(handle, {
          url: args.url,
          token: args.token || null,
          ref: args.ref ?? "main",
        });
        // Anchor the local worktree at the cloned HEAD so the next sync
        // sees a clean baseline (no false-positive "everything changed
        // locally" diff against an unknown baseline).
        initialHeadSha = cloneResult.headSha || null;
      } else {
        // Init-existing: keep OPFS cache so the local index survives.
        step = "init-remote";
        await initInVault(handle, {
          url: args.url,
          token: args.token || null,
          ref: args.ref ?? "main",
        });
      }

      step = "persist-config";
      await saveGitConfig({
        url: args.url,
        token: args.token || null,
        ref: args.ref ?? "main",
        lastSyncSha: initialHeadSha,
        lastSyncAt: initialHeadSha ? new Date().toISOString() : undefined,
      });
      // Archive the outgoing vault's sync config before repointing (per-vault
      // sync), while currentActiveVaultId still resolves the previous vault.
      archiveActiveSyncConfig(await currentActiveVaultId());
      await saveVaultHandle(handle);
      if (typeof window !== "undefined") {
        // Picking a folder / git repo opts out of degraded mode and drops the
        // cloud marker.
        window.localStorage.removeItem(DEGRADED_STORAGE_KEY);
        leaveCloudMode();
      }
      // A fresh Git vault starts with online sync off (Git is its sync layer);
      // the user can opt in later from Settings. Reset to a clean state so it
      // can't inherit the previous vault's room.
      saveOnlineSyncConfig({ ...DEFAULT_ONLINE_SYNC_CONFIG });
      setWorkerReady(false);
      setVaultName(null);
      setState("loading");
      void refreshRecents();
      // Only "clone-into-empty" reset the OPFS (and just terminated the
      // worker above). "init-existing" keeps both the previous OPFS and the
      // worker — feed the existing index into the new folder. Coming from a
      // cloud vault overrides that: the cached DB belongs to the room.
      startWorker(handle, {
        resetStorage: args.mode === "clone-into-empty" || wasCloud,
      });
    } catch (err) {
      // Label the failure with the step that was running so the user (and
      // the dev console) sees exactly which phase blew up. The raw FSA
      // error message ("A requested file or directory could not be found
      // at the time an operation was processed.") is otherwise too generic
      // to debug.
      const raw = (err as Error).message || String(err);
      console.error(`[git-setup] step=${step} failed:`, err);
      setErrorMsg(`Échec à l'étape « ${step} » : ${raw}`);
      setState("error");
    }
  }, []);

  // Activate a cloud vault from the registry: point online-sync at its room,
  // reboot the OPFS-backed worker from a clean slate, and let OnlineSyncProvider
  // reconnect + reseed from that room's op-log on the next "ready".
  const switchToCloudVault = useCallback(async (id: string) => {
    setErrorMsg(null);
    const entry = getCloudVault(id);
    if (!entry) {
      setErrorMsg("Ce coffre cloud n'existe plus dans l'historique.");
      return;
    }
    const cfg = loadOnlineSyncConfig();
    const activeCloudId = isCloudVaultActive()
      ? cloudVaultId(cfg.serverUrl, cfg.vaultKey)
      : null;
    // Already mounted → just bump recency, no reboot.
    if (id === activeCloudId) {
      upsertCloudVault({ serverUrl: entry.serverUrl, vaultKey: entry.vaultKey, token: entry.token });
      void refreshRecents();
      return;
    }
    // Tear down the current worker FIRST. terminateVaultWorker dispatches
    // "supernote:vault-unready" → the OnlineSyncProvider stops the previous
    // room's sync client SYNCHRONOUSLY, before its config is overwritten
    // below. Otherwise the old client's in-flight stream batches would be
    // queued against the new room's worker (drained at its VAULT_READY) and
    // its late onSeq callbacks would poison the new room's cursor.
    // Stash the outgoing vault's sync config under its own id before the room
    // config below overwrites the active slot — so switching back to a folder
    // vault (or another cloud room) restores its own connection.
    archiveActiveSyncConfig(await currentActiveVaultId());

    // Show the loading overlay NOW, before tearing the worker down: the
    // teardown + handle acquisition + reindex happen with no visible feedback
    // otherwise, which reads as a frozen UI during a switch.
    setState("loading");
    setWorkerReady(false);
    setVaultName(null);
    terminateVaultWorker();

    if (typeof window !== "undefined") {
      // Cloud marker BEFORE the config swap — see setupCloudVault.
      window.localStorage.setItem(CLOUD_VAULT_KEY, "1");
      window.localStorage.removeItem(DEGRADED_STORAGE_KEY);
    }
    // Reset the cursor/seed so the new room replays + re-seeds from scratch.
    saveOnlineSyncConfig({
      ...DEFAULT_ONLINE_SYNC_CONFIG,
      enabled: true,
      serverUrl: entry.serverUrl,
      vaultKey: entry.vaultKey,
      token: entry.token,
    });
    upsertCloudVault({ serverUrl: entry.serverUrl, vaultKey: entry.vaultKey, token: entry.token });

    try {
      // Boot the chosen room's own namespaced OPFS dir. resetStorage wipes
      // the (origin-global) SAH-pool DB only; the room's files are its own —
      // the reindex re-adopts them into the fresh DB, then the server replay
      // fills the gaps. The previous room's files (incl. canvas .excalidraw,
      // which the op-log does NOT transport) stay untouched in THEIR dir.
      recordCloudBoot(entry.id);
      const handle = await getCloudVaultHandle(entry.id);
      setState("loading");
      void refreshRecents();
      startWorker(handle, { cloud: true, resetStorage: true });
    } catch (err) {
      setErrorMsg(`Impossible d'ouvrir le coffre cloud : ${String(err)}`);
      setState("error");
    }
  }, [refreshRecents]);

  const switchToVault = useCallback(async (id: string) => {
    // Cloud vaults carry a `cloud:` id and live in a separate registry/flow.
    if (id.startsWith("cloud:")) {
      await switchToCloudVault(id);
      return;
    }
    setErrorMsg(null);
    const entry = await getVaultEntry(id);
    if (!entry) {
      setErrorMsg("Ce vault n'existe plus dans l'historique.");
      return;
    }
    // No-op if the user clicks the already-active vault — but still refresh
    // `lastOpenedAt` so it stays at the top of the recents list.
    if (id === activeVaultId) {
      await upsertVaultEntry(entry.handle);
      void refreshRecents();
      return;
    }

    // Permission state is NOT persisted across sessions, so a registry
    // entry that worked yesterday may need re-authorisation today.
    const granted = await verifyHandlePermission(entry.handle, true);
    if (!granted) {
      setErrorMsg("Permission refusée pour ce dossier.");
      return;
    }

    // Different folder → terminate the current worker so its in-flight RPCs
    // don't land on the new vault, then ask the FRESH worker to unlink the
    // OPFS-resident DB via the SAH pool API (resetStorage flag below).
    // Doing the OPFS clear on the main thread is unreliable: SAH file
    // handles are released asynchronously after worker termination, so
    // `removeEntry("/supernote-vfs", { recursive: true })` silently fails
    // and the previous vault's data leaks into the next session.
    // Coming FROM a cloud vault always counts as different: the persisted
    // folder handle was never updated by the cloud flows, so returning to
    // the folder used before a cloud detour would compare equal and keep the
    // CLOUD room's DB (the SAH pool is global) mounted over this folder —
    // then mirror the room's notes onto the user's disk.
    // Overlay up before teardown/reindex so the switch never looks frozen.
    setState("loading");
    const wasCloud = isCloudVaultActive();
    let isDifferentFolder = true;
    try {
      const previous = await loadVaultHandle().catch(() => null);
      isDifferentFolder =
        wasCloud ||
        !previous ||
        !(await previous.isSameEntry(entry.handle).catch(() => false));
    } catch {
      // Treat any failure to read the previous handle as "different", which
      // is the conservative choice (wipe rather than risk a data mix).
      isDifferentFolder = true;
    }
    // Online sync is per-vault: stash the outgoing vault's connection under its
    // own id BEFORE we repoint anything, so returning to it reconnects.
    archiveActiveSyncConfig(await currentActiveVaultId());

    if (isDifferentFolder) {
      terminateVaultWorker();
    }

    await saveVaultHandle(entry.handle);
    await setActiveVaultId(entry.id);
    if (typeof window !== "undefined") window.localStorage.removeItem(DEGRADED_STORAGE_KEY);
    // Drop the cloud marker / DB-owner record (no longer touches the config).
    leaveCloudMode();
    // Adopt THIS vault's own remembered sync config (cursor reset because the
    // DB is re-indexed; a never-synced vault restores to a clean, off state and
    // so can't inherit the previous room's key).
    restoreFolderSyncConfig(entry.id);
    setWorkerReady(false);
    setVaultName(null);
    setState("loading");
    void refreshRecents();
    startWorker(entry.handle, { resetStorage: isDifferentFolder });
  }, [activeVaultId, refreshRecents, switchToCloudVault]);

  const forgetVault = useCallback(async (id: string) => {
    if (id === activeVaultId) return;
    // Never forget the ACTIVE cloud vault. activeVaultId only tracks folder
    // vaults, so without this a cloud vault could be forgotten while its
    // worker still holds the room directory open — deleteCloudRoom's removeEntry
    // then fails silently (locked), the .md files survive, and the next reindex
    // re-adopts them ("resurrection" on reload). Require switching away first.
    if (id.startsWith("cloud:") && isCloudVaultActive()) {
      const cfg = loadOnlineSyncConfig();
      if (cloudVaultId(cfg.serverUrl, cfg.vaultKey) === id) return;
    }
    if (id.startsWith("cloud:")) {
      const entry = getCloudVault(id);
      removeCloudVault(id);
      if (entry) {
        // Drop the room's namespaced local files (its server op-log is
        // untouched — re-adding the room replays the notes back).
        void deleteCloudRoom(id);
        // Drop its pending-ops journal — but ONLY if no other registered
        // room (nor the active sync config, which may belong to a folder
        // vault with sync enabled) shares the same room key: the journal is
        // keyed by vaultKey alone, and clearing a shared key would destroy
        // another vault's not-yet-acknowledged ops.
        const cfg = loadOnlineSyncConfig();
        const sharedByActiveConfig =
          cfg.enabled && normalizeVaultKey(cfg.vaultKey) === entry.vaultKey;
        const sharedByOtherRoom = listCloudVaults().some(
          (e) => e.id !== id && e.vaultKey === entry.vaultKey,
        );
        if (!sharedByActiveConfig && !sharedByOtherRoom) {
          clearPendingOps(entry.vaultKey);
        }
      }
    } else {
      await removeVaultEntry(id);
    }
    // Drop the vault's remembered online-sync connection too.
    removeVaultSyncBinding(id);
    void refreshRecents();
  }, [activeVaultId, refreshRecents]);

  return {
    state,
    errorMsg,
    vaultName,
    pickFolder,
    startGitFlow,
    cancelGitFlow,
    setupGitVault,
    startCloudFlow,
    cancelCloudFlow,
    setupCloudVault,
    skipToDegraded,
    isPwa,
    canCloud,
    recentVaults,
    activeVaultId,
    switchToVault,
    forgetVault,
  };
}

function startWorker(
  handle: FileSystemDirectoryHandle,
  opts: { resetStorage?: boolean; cloud?: boolean } = {},
): void {
  initWorkerVault(handle, opts);
}

/**
 * Leaving cloud mode for a folder/git vault: drop the cloud marker and
 * invalidate the DB-owner record.
 *
 * It deliberately does NOT touch the online-sync config — sync is a per-vault
 * property now. Callers archive the outgoing vault's config and restore the
 * incoming folder vault's own config (see {@link archiveActiveSyncConfig} /
 * {@link restoreFolderSyncConfig}) around this call, so a folder vault keeps
 * its sync across switches and a local-only vault never inherits the previous
 * room's key.
 */
function leaveCloudMode(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(CLOUD_VAULT_KEY);
  // The folder/git vault is about to take over the (origin-global) SAH DB —
  // the recorded cloud room no longer owns it. Without this invalidation, a
  // later cloud boot back onto that same room would see a matching owner,
  // skip its reset and mount the FOLDER vault's DB under the room's label.
  void clearDbOwner();
}

/**
 * Id of the vault the worker is currently mounted on — folder id (FSA registry)
 * or cloud id (derived from the live room config). Mirrors the active-id logic
 * in refreshRecents so the outgoing vault's sync config is archived under the
 * right key on a switch. Null when no vault is active yet.
 */
async function currentActiveVaultId(): Promise<string | null> {
  if (isCloudVaultActive()) {
    const cfg = loadOnlineSyncConfig();
    return cfg.vaultKey ? cloudVaultId(cfg.serverUrl, cfg.vaultKey) : null;
  }
  return getActiveVaultId().catch(() => null);
}

// ── UI Component ──────────────────────────────────────────────────────────────

export function PwaVaultSetup({ children }: { children: React.ReactNode }) {
  const value = usePwaVaultSetup();
  const {
    state,
    errorMsg,
    pickFolder,
    startGitFlow,
    cancelGitFlow,
    setupGitVault,
    startCloudFlow,
    cancelCloudFlow,
    setupCloudVault,
    skipToDegraded,
    isPwa,
    canCloud,
  } = value;

  const showOverlay =
    (isPwa || canCloud) &&
    state !== "ready" &&
    state !== "degraded" &&
    state !== "idle" &&
    state !== "checking";

  let overlay: React.ReactNode = null;
  if (showOverlay) {
    if (state === "loading") {
      overlay = (
        <PwaOverlay>
          <LoadingSpinner />
          <p style={styles.subtitle}>Ouverture du vault…</p>
        </PwaOverlay>
      );
    } else if (state === "cloning") {
      overlay = (
        <PwaOverlay>
          <LoadingSpinner />
          <p style={styles.subtitle}>Clonage du dépôt en cours…</p>
          <p style={{ ...styles.subtitle, fontSize: 12, opacity: 0.7 }}>
            Selon la taille du repo, cela peut prendre quelques secondes.
          </p>
        </PwaOverlay>
      );
    } else if (state === "error") {
      overlay = (
        <PwaOverlay>
          <p style={styles.title}>Erreur</p>
          <p style={styles.error}>{errorMsg}</p>
          {isPwa && (
            <Button
              type="button"
              variant="primary"
              onPress={() => void pickFolder()}
              className="w-full"
              style={{ fontSize: 15, fontWeight: 600, padding: "12px 24px" }}
            >
              Choisir un dossier local
            </Button>
          )}
          {isPwa && (
            <Button
              type="button"
              variant="outline"
              onPress={startGitFlow}
              className="w-full"
              style={{ fontSize: 14, fontWeight: 500, padding: "10px 24px" }}
            >
              Réessayer avec un dépôt Git
            </Button>
          )}
          {canCloud && (
            <Button
              type="button"
              variant={isPwa ? "outline" : "primary"}
              onPress={startCloudFlow}
              className="w-full"
              style={{ fontSize: 14, fontWeight: 500, padding: "10px 24px" }}
            >
              Réessayer la synchronisation cloud
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            onPress={skipToDegraded}
            className="w-full underline underline-offset-[3px]"
            style={{ fontSize: 13, color: "#6b7280" }}
          >
            Continuer sans dossier
          </Button>
        </PwaOverlay>
      );
    } else if (state === "git-form") {
      overlay = (
        <PwaOverlay wide>
          <GitSetupForm
            onSubmit={(args) => void setupGitVault(args)}
            onCancel={cancelGitFlow}
          />
        </PwaOverlay>
      );
    } else if (state === "cloud-form") {
      overlay = (
        <PwaOverlay wide>
          <CloudSetupForm
            onSubmit={(args) => void setupCloudVault(args)}
            onCancel={cancelCloudFlow}
            errorMsg={errorMsg}
          />
        </PwaOverlay>
      );
    } else {
      // "prompt" or "picking" — welcome modal. Folder + Git cards require the
      // FSA picker (isPwa); the Cloud card only needs OPFS (canCloud), so on
      // phones / Safari it's the sole — and primary — option.
      const cardCount = (isPwa ? 2 : 0) + (canCloud ? 1 : 0);
      overlay = (
        <PwaOverlay wide>
          <div style={styles.logo}>S</div>
          <h1 style={styles.title}>Bienvenue sur Supernote</h1>
          <p style={styles.subtitle}>
            {isPwa
              ? "Choisissez où vos notes vivront — un dossier local sur cet appareil, un dépôt Git, ou la synchronisation cloud temps réel entre tous vos appareils."
              : "Connectez-vous à la synchronisation cloud pour retrouver vos notes en temps réel depuis cet appareil et tous les autres."}
          </p>

          <div
            style={{
              ...styles.choiceGrid,
              gridTemplateColumns:
                cardCount >= 3
                  ? "1fr 1fr 1fr"
                  : cardCount === 2
                    ? "1fr 1fr"
                    : "1fr",
            }}
          >
            {isPwa && (
              <Button
                type="button"
                variant="ghost"
                onPress={() => void pickFolder()}
                isDisabled={state === "picking"}
                style={styles.choiceCard}
                className="h-auto flex-col items-center gap-2 p-0"
              >
                <div style={styles.choiceIcon}>📁</div>
                <div style={styles.choiceTitle}>Dossier local</div>
                <div style={styles.choiceDesc}>
                  Vos notes restent sur cet appareil. Idéal pour démarrer
                  rapidement, sans configuration.
                </div>
              </Button>
            )}

            {isPwa && (
              <Button
                type="button"
                variant="ghost"
                onPress={startGitFlow}
                isDisabled={state === "picking"}
                style={styles.choiceCard}
                className="h-auto flex-col items-center gap-2 p-0"
              >
                <div style={styles.choiceIcon}>🔀</div>
                <div style={styles.choiceTitle}>Dépôt Git</div>
                <div style={styles.choiceDesc}>
                  Synchronise vos notes via un repo GitHub / GitLab / Forgejo.
                  Accessible depuis tous vos appareils.
                </div>
              </Button>
            )}

            {canCloud && (
              <Button
                type="button"
                variant="ghost"
                onPress={startCloudFlow}
                isDisabled={state === "picking"}
                style={styles.choiceCard}
                className="h-auto flex-col items-center gap-2 p-0"
              >
                <div style={styles.choiceIcon}>☁️</div>
                <div style={styles.choiceTitle}>Cloud temps réel</div>
                <div style={styles.choiceDesc}>
                  Réplique le coffre via un serveur, en direct, entre PC et
                  téléphone. Une clé de salon partagée suffit.
                </div>
              </Button>
            )}
          </div>

          <Button
            type="button"
            variant="ghost"
            onPress={skipToDegraded}
            className="w-full underline underline-offset-[3px]"
            style={{ fontSize: 13, color: "#6b7280" }}
          >
            Continuer sans dossier (mode limité)
          </Button>
        </PwaOverlay>
      );
    }
  }

  return (
    <VaultContext.Provider value={value}>
      {children}
      {overlay}
    </VaultContext.Provider>
  );
}

// ── Git setup form ─────────────────────────────────────────────────────────────

function GitSetupForm({
  onSubmit,
  onCancel,
}: {
  onSubmit: (args: GitSetupArgs) => void;
  onCancel: () => void;
}) {
  const [url, setUrl] = useState("");
  const [token, setToken] = useState("");
  const [ref, setRef] = useState("main");
  const [mode, setMode] = useState<"clone-into-empty" | "init-existing">("clone-into-empty");

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return;
    onSubmit({ url: url.trim(), token: token.trim(), ref: ref.trim() || "main", mode });
  };

  return (
    <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 14, textAlign: "left" }}>
      <div style={{ textAlign: "center" }}>
        <div style={styles.logo}>🔀</div>
        <h1 style={styles.title}>Connecter un dépôt Git</h1>
        <p style={{ ...styles.subtitle, marginTop: 8 }}>
          La PWA clonera (ou initialisera) le dépôt dans le dossier que vous
          choisissez. Ensuite chaque modification sera commit&apos;ée et
          poussée automatiquement.
        </p>
      </div>

      <label style={styles.label}>
        URL HTTPS du dépôt
        <input
          type="url"
          required
          placeholder="https://github.com/votre-utilisateur/notes.git"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          style={styles.input}
          autoComplete="off"
          spellCheck={false}
        />
      </label>

      <label style={styles.label}>
        Personal Access Token (PAT)
        <input
          type="password"
          placeholder="Optionnel pour un repo public"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          style={styles.input}
          autoComplete="off"
        />
        <span style={styles.hint}>
          Stocké uniquement dans IndexedDB sur cet appareil — jamais envoyé au
          dépôt. Pour GitHub :{" "}
          <code>Settings → Developer settings → Personal access tokens →
          Fine-grained → repo scope</code>.
        </span>
      </label>

      <label style={styles.label}>
        Branche
        <input
          type="text"
          value={ref}
          onChange={(e) => setRef(e.target.value)}
          style={styles.input}
          spellCheck={false}
        />
      </label>

      <div style={styles.label}>
        Mode
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 6 }}>
          <label style={styles.radioRow}>
            <input
              type="radio"
              checked={mode === "clone-into-empty"}
              onChange={() => setMode("clone-into-empty")}
            />
            <span>
              <strong>Cloner</strong> dans un dossier vide (récupère un repo
              existant)
            </span>
          </label>
          <label style={styles.radioRow}>
            <input
              type="radio"
              checked={mode === "init-existing"}
              onChange={() => setMode("init-existing")}
            />
            <span>
              <strong>Initialiser</strong> dans un dossier existant (push
              vos notes locales vers un repo neuf)
            </span>
          </label>
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
        <Button
          type="button"
          variant="outline"
          onPress={onCancel}
          style={{ flex: 1, fontSize: 14, fontWeight: 500, padding: "10px 24px" }}
        >
          Retour
        </Button>
        <Button
          type="submit"
          variant="primary"
          style={{ flex: 2, fontSize: 15, fontWeight: 600, padding: "12px 24px" }}
        >
          Choisir le dossier et continuer
        </Button>
      </div>
    </form>
  );
}

// ── Cloud (online-sync) setup form ─────────────────────────────────────────────

function CloudSetupForm({
  onSubmit,
  onCancel,
  errorMsg,
}: {
  onSubmit: (args: CloudSetupArgs) => void;
  onCancel: () => void;
  errorMsg: string | null;
}) {
  const [serverUrl, setServerUrl] = useState("");
  const [vaultKey, setVaultKey] = useState("");
  const [token, setToken] = useState("");

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!vaultKey.trim()) return;
    onSubmit({ serverUrl: serverUrl.trim(), vaultKey: vaultKey.trim(), token: token.trim() });
  };

  return (
    <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 14, textAlign: "left" }}>
      <div style={{ textAlign: "center" }}>
        <div style={styles.logo}>☁️</div>
        <h1 style={styles.title}>Synchronisation cloud</h1>
        <p style={{ ...styles.subtitle, marginTop: 8 }}>
          Tous les appareils utilisant la <strong>même clé de salon</strong> sur
          le même serveur partagent un coffre, répliqué en temps réel. Sur un
          nouvel appareil, ce coffre est récupéré automatiquement depuis le
          serveur.
        </p>
      </div>

      {errorMsg && <p style={styles.error}>{errorMsg}</p>}

      <label style={styles.label}>
        Serveur
        <input
          type="url"
          placeholder="Même origine que l'application (par défaut)"
          value={serverUrl}
          onChange={(e) => setServerUrl(e.target.value)}
          style={styles.input}
          autoComplete="off"
          spellCheck={false}
        />
        <span style={styles.hint}>
          Laisser vide pour utiliser le serveur Supernote qui sert cette page
          (s&apos;il a une base de données). Sinon, l&apos;URL de votre serveur
          de synchronisation.
        </span>
      </label>

      <label style={styles.label}>
        Clé de salon
        <input
          type="text"
          required
          placeholder="mon-coffre-perso"
          value={vaultKey}
          onChange={(e) => setVaultKey(e.target.value)}
          style={styles.input}
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
        />
        <span style={styles.hint}>
          La même chaîne sur votre PC et votre téléphone pour les apparier (la
          casse est ignorée). Traitez-la comme un mot de passe : qui la connaît
          accède au coffre.
        </span>
      </label>

      <label style={styles.label}>
        Jeton (optionnel)
        <input
          type="password"
          placeholder="Si le serveur exige un secret partagé"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          style={styles.input}
          autoComplete="off"
        />
      </label>

      <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
        <Button
          type="button"
          variant="outline"
          onPress={onCancel}
          style={{ flex: 1, fontSize: 14, fontWeight: 500, padding: "10px 24px" }}
        >
          Retour
        </Button>
        <Button
          type="submit"
          variant="primary"
          isDisabled={!vaultKey.trim()}
          style={{ flex: 2, fontSize: 15, fontWeight: 600, padding: "12px 24px" }}
        >
          Connecter et ouvrir le coffre
        </Button>
      </div>
    </form>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function PwaOverlay({ children, wide = false }: { children: React.ReactNode; wide?: boolean }) {
  return (
    <div style={styles.backdrop}>
      <div style={wide ? { ...styles.card, maxWidth: 560 } : styles.card}>{children}</div>
    </div>
  );
}

function LoadingSpinner() {
  return (
    <div
      style={{
        width: 40,
        height: 40,
        border: "3px solid #e5e7eb",
        borderTopColor: "#7c3aed",
        borderRadius: "50%",
        animation: "spin 0.8s linear infinite",
        margin: "0 auto 16px",
      }}
    />
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  backdrop: {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.6)",
    backdropFilter: "blur(4px)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 10000,
  },
  card: {
    background: "#ffffff",
    borderRadius: 16,
    padding: "40px 36px",
    maxWidth: 460,
    width: "90%",
    textAlign: "center",
    boxShadow: "0 24px 48px rgba(0,0,0,0.25)",
    display: "flex",
    flexDirection: "column",
    gap: 16,
  },
  logo: {
    width: 64,
    height: 64,
    background: "#7c3aed",
    borderRadius: 16,
    color: "#fff",
    fontSize: 32,
    fontWeight: 700,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    margin: "0 auto",
  },
  title: {
    fontSize: 22,
    fontWeight: 700,
    color: "#111827",
    margin: 0,
  },
  subtitle: {
    fontSize: 14,
    color: "#6b7280",
    lineHeight: 1.6,
    margin: 0,
  },
  featureList: {
    textAlign: "left",
    paddingLeft: 20,
    fontSize: 13,
    color: "#374151",
    lineHeight: 1.8,
    margin: 0,
  },
  btnPrimary: {
    background: "#7c3aed",
    color: "#fff",
    border: "none",
    borderRadius: 8,
    padding: "12px 24px",
    fontSize: 15,
    fontWeight: 600,
    cursor: "pointer",
    width: "100%",
  },
  btnSecondary: {
    background: "transparent",
    color: "#374151",
    border: "1px solid #d1d5db",
    borderRadius: 8,
    padding: "10px 24px",
    fontSize: 14,
    fontWeight: 500,
    cursor: "pointer",
    width: "100%",
  },
  btnGhost: {
    background: "transparent",
    color: "#6b7280",
    border: "none",
    padding: "8px 12px",
    fontSize: 13,
    cursor: "pointer",
    width: "100%",
    textDecoration: "underline",
    textUnderlineOffset: "3px",
  },
  error: {
    color: "#dc2626",
    fontSize: 13,
    background: "#fef2f2",
    borderRadius: 6,
    padding: "8px 12px",
    margin: 0,
  },
  choiceGrid: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 12,
    marginTop: 8,
  },
  choiceCard: {
    background: "#f9fafb",
    border: "1px solid #e5e7eb",
    borderRadius: 12,
    padding: "20px 16px",
    cursor: "pointer",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 8,
    textAlign: "center",
    transition: "border-color 160ms, background 160ms, transform 80ms",
    minWidth: 0,
    width: "100%",
    whiteSpace: "normal",
  },
  choiceIcon: {
    fontSize: 32,
    lineHeight: 1,
  },
  choiceTitle: {
    fontSize: 15,
    fontWeight: 600,
    color: "#111827",
  },
  choiceDesc: {
    fontSize: 12,
    color: "#6b7280",
    lineHeight: 1.5,
  },
  label: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
    fontSize: 13,
    fontWeight: 600,
    color: "#374151",
  },
  input: {
    border: "1px solid #d1d5db",
    borderRadius: 8,
    padding: "10px 12px",
    fontSize: 14,
    fontWeight: 400,
    color: "#111827",
    background: "#fff",
    outline: "none",
  },
  hint: {
    fontSize: 11,
    fontWeight: 400,
    color: "#9ca3af",
    lineHeight: 1.5,
    marginTop: 2,
  },
  radioRow: {
    display: "flex",
    alignItems: "flex-start",
    gap: 8,
    fontSize: 13,
    fontWeight: 400,
    color: "#374151",
    cursor: "pointer",
    lineHeight: 1.5,
  },
};
