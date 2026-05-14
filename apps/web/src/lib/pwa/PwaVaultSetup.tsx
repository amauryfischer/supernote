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
import { initWorkerVault, onWorkerMessage, setWorkerReady, flushVaultWorker } from "@/lib/trpc/browser-link";
import { isBrowserPwaMode } from "@/lib/trpc/client";
import type { VaultReadyMessage, VaultErrorMessage } from "@/lib/vault-worker/worker-protocol";
import { cloneIntoVault, initInVault, isLinked } from "@/lib/git/github-sync";
import { saveGitConfig } from "@/lib/git/config-storage";
import { clearOpfsDb } from "@/lib/vault-worker/db-persistence";

const DEGRADED_STORAGE_KEY = "supernote.degraded";

type SetupState =
  | "idle"        // Checking for existing handle
  | "checking"    // Verifying stored handle permission
  | "ready"       // Vault is initialized
  | "prompt"      // Welcome — choose between local folder and git repo
  | "git-form"    // Git setup form (URL + PAT + folder)
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

/** Lightweight projection of {@link VaultEntry} exposed to UI consumers. */
export interface RecentVault {
  id: string;
  name: string;
  lastOpenedAt: number;
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
  /** Continue without a vault folder (localStorage degraded mode). */
  skipToDegraded: () => void;
  /** True only in PWA mode (FSA available, no Electron bridge). */
  isPwa: boolean;
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

  // Only runs in PWA mode (FSA available, no Electron)
  const isPwa = isBrowserPwaMode();

  // Refresh the in-memory recents projection from IDB. Cheap (≤ a handful of
  // entries) so we call it from any code path that mutates the registry.
  const refreshRecents = useCallback(async () => {
    try {
      const [entries, active] = await Promise.all([
        listVaults(),
        getActiveVaultId(),
      ]);
      setRecentVaults(
        entries.map((e) => ({ id: e.id, name: e.name, lastOpenedAt: e.lastOpenedAt })),
      );
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
    if (!isPwa) { setState("ready"); return; }
    if (initStartedRef.current) return;
    initStartedRef.current = true;

    // If the user previously chose degraded mode, honour that decision
    // immediately and skip the picker entirely on every subsequent visit.
    if (typeof window !== "undefined" && window.localStorage.getItem(DEGRADED_STORAGE_KEY) === "1") {
      setState("degraded");
      return;
    }

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
  }, [isPwa]);

  useEffect(() => {
    if (state !== "loading") return;
    const cleanup = onWorkerMessage((msg) => {
      const m = msg as VaultReadyMessage | VaultErrorMessage;
      if (m.type === "VAULT_READY") {
        setVaultName((m as VaultReadyMessage).vaultName);
        setWorkerReady(true);
        setState("ready");
        // The worker just finished mounting a handle — make sure the
        // recents list and active id reflect that (covers the bootstrap
        // path where the registry hadn't been touched yet).
        void refreshRecents();
      } else if (m.type === "VAULT_ERROR") {
        setErrorMsg((m as VaultErrorMessage).error);
        setState("error");
      }
    });
    return cleanup;
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
      const previous = await loadVaultHandle().catch(() => null);
      if (!previous || !(await previous.isSameEntry(handle).catch(() => false))) {
        await clearOpfsDb();
      }
      await saveVaultHandle(handle);
      // Picking a folder explicitly opts out of degraded mode.
      if (typeof window !== "undefined") window.localStorage.removeItem(DEGRADED_STORAGE_KEY);
      setWorkerReady(false);
      setVaultName(null);
      setState("loading");
      void refreshRecents();
      startWorker(handle);
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
    if (typeof window !== "undefined") window.localStorage.setItem(DEGRADED_STORAGE_KEY, "1");
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
    try {
      step = "check-linked";
      const alreadyLinked = await isLinked(handle);
      if (alreadyLinked) {
        // No-op — config is refreshed below.
      } else if (args.mode === "clone-into-empty") {
        step = "clear-opfs";
        await clearOpfsDb();
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
      await saveVaultHandle(handle);
      if (typeof window !== "undefined") window.localStorage.removeItem(DEGRADED_STORAGE_KEY);
      setWorkerReady(false);
      setVaultName(null);
      setState("loading");
      void refreshRecents();
      startWorker(handle);
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

  const switchToVault = useCallback(async (id: string) => {
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

    // Different folder → wipe the OPFS-cached SQLite index so the worker
    // doesn't resurrect the previous vault's data. Same dedup logic as
    // `pickFolder`. Best-effort — if the handle was invalidated we still
    // try to clear the cache so we start from a clean slate.
    try {
      const previous = await loadVaultHandle().catch(() => null);
      if (!previous || !(await previous.isSameEntry(entry.handle).catch(() => false))) {
        await clearOpfsDb();
      }
    } catch (err) {
      console.warn("[pwa-vault] OPFS clear skipped", err);
    }

    await saveVaultHandle(entry.handle);
    await setActiveVaultId(entry.id);
    if (typeof window !== "undefined") window.localStorage.removeItem(DEGRADED_STORAGE_KEY);
    setWorkerReady(false);
    setVaultName(null);
    setState("loading");
    void refreshRecents();
    startWorker(entry.handle);
  }, [activeVaultId, refreshRecents]);

  const forgetVault = useCallback(async (id: string) => {
    if (id === activeVaultId) return;
    await removeVaultEntry(id);
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
    skipToDegraded,
    isPwa,
    recentVaults,
    activeVaultId,
    switchToVault,
    forgetVault,
  };
}

function startWorker(handle: FileSystemDirectoryHandle): void {
  initWorkerVault(handle);
}

// ── UI Component ──────────────────────────────────────────────────────────────

export function PwaVaultSetup({ children }: { children: React.ReactNode }) {
  const value = usePwaVaultSetup();
  const { state, errorMsg, pickFolder, startGitFlow, cancelGitFlow, setupGitVault, skipToDegraded, isPwa } = value;

  const showOverlay =
    isPwa &&
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
          <Button
            type="button"
            variant="primary"
            onPress={() => void pickFolder()}
            className="w-full"
            style={{ fontSize: 15, fontWeight: 600, padding: "12px 24px" }}
          >
            Choisir un dossier local
          </Button>
          <Button
            type="button"
            variant="outline"
            onPress={startGitFlow}
            className="w-full"
            style={{ fontSize: 14, fontWeight: 500, padding: "10px 24px" }}
          >
            Réessayer avec un dépôt Git
          </Button>
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
    } else {
      // "prompt" or "picking" — welcome modal with two source choices
      overlay = (
        <PwaOverlay wide>
          <div style={styles.logo}>S</div>
          <h1 style={styles.title}>Bienvenue sur Supernote</h1>
          <p style={styles.subtitle}>
            Choisissez l&apos;emplacement où vos notes vivront — un dossier
            local sur cet appareil, ou un dépôt Git que vous synchronisez
            entre plusieurs appareils.
          </p>

          <div style={styles.choiceGrid}>
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
