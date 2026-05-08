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
import { saveVaultHandle, loadVaultHandle, verifyHandlePermission } from "@/lib/vault-worker/vault-handle-storage";
import { initWorkerVault, onWorkerMessage, setWorkerReady, flushVaultWorker } from "@/lib/trpc/browser-link";
import { isBrowserPwaMode } from "@/lib/trpc/client";
import type { VaultReadyMessage, VaultErrorMessage } from "@/lib/vault-worker/worker-protocol";

const DEGRADED_STORAGE_KEY = "supernote.degraded";

type SetupState =
  | "idle"        // Checking for existing handle
  | "checking"    // Verifying stored handle permission
  | "ready"       // Vault is initialized
  | "prompt"      // Show the welcome modal
  | "picking"     // showDirectoryPicker in progress
  | "loading"     // Worker initializing
  | "error"       // Init failed
  | "degraded";   // User chose localStorage mode

interface VaultContextValue {
  state: SetupState;
  errorMsg: string | null;
  vaultName: string | null;
  /** Open the FSA folder picker and re-initialise the worker with the chosen folder. */
  pickFolder: () => Promise<void>;
  /** Continue without a vault folder (localStorage degraded mode). */
  skipToDegraded: () => void;
  /** True only in PWA mode (FSA available, no Electron bridge). */
  isPwa: boolean;
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

  // Only runs in PWA mode (FSA available, no Electron)
  const isPwa = isBrowserPwaMode();

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
      await saveVaultHandle(handle);
      // Picking a folder explicitly opts out of degraded mode.
      if (typeof window !== "undefined") window.localStorage.removeItem(DEGRADED_STORAGE_KEY);
      setWorkerReady(false);
      setVaultName(null);
      setState("loading");
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

  return { state, errorMsg, vaultName, pickFolder, skipToDegraded, isPwa };
}

function startWorker(handle: FileSystemDirectoryHandle): void {
  initWorkerVault(handle);
}

// ── UI Component ──────────────────────────────────────────────────────────────

export function PwaVaultSetup({ children }: { children: React.ReactNode }) {
  const value = usePwaVaultSetup();
  const { state, errorMsg, pickFolder, skipToDegraded, isPwa } = value;

  // Decide whether an overlay is currently visible. Critically, we ALWAYS
  // render `<>{children}{overlay}</>` so the React tree shape is stable
  // between transitions. Children never unmount when the overlay toggles.
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
          <p style={styles.subtitle}>Ouverture du vault...</p>
        </PwaOverlay>
      );
    } else if (state === "error") {
      overlay = (
        <PwaOverlay>
          <p style={styles.title}>Erreur</p>
          <p style={styles.error}>{errorMsg}</p>
          <button style={styles.btnPrimary} onClick={() => void pickFolder()}>
            Réessayer
          </button>
          <button style={styles.btnSecondary} onClick={skipToDegraded}>
            Continuer sans dossier
          </button>
        </PwaOverlay>
      );
    } else {
      // "prompt" or "picking" — welcome modal
      overlay = (
        <PwaOverlay>
          <div style={styles.logo}>S</div>
          <h1 style={styles.title}>Bienvenue sur Supernote</h1>
          <p style={styles.subtitle}>
            Pour stocker vos notes localement et les retrouver à chaque visite,
            choisissez un dossier sur votre disque.
          </p>
          <ul style={styles.featureList}>
            <li>Fichiers <code>.md</code> dans votre dossier — pas de lock-in</li>
            <li>SQLite local — aucune donnée n&apos;est envoyée sur un serveur</li>
            <li>Fonctionne hors-ligne une fois installé</li>
          </ul>
          <button
            style={styles.btnPrimary}
            onClick={() => void pickFolder()}
            disabled={state === "picking"}
          >
            {state === "picking" ? "Sélection..." : "Choisir un dossier"}
          </button>
          <button style={styles.btnSecondary} onClick={skipToDegraded}>
            Continuer sans dossier (mode limité)
          </button>
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

// ── Sub-components ─────────────────────────────────────────────────────────────

function PwaOverlay({ children }: { children: React.ReactNode }) {
  return (
    <div style={styles.backdrop}>
      <div style={styles.card}>{children}</div>
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
    color: "#6b7280",
    border: "1px solid #d1d5db",
    borderRadius: 8,
    padding: "10px 24px",
    fontSize: 13,
    cursor: "pointer",
    width: "100%",
  },
  error: {
    color: "#dc2626",
    fontSize: 13,
    background: "#fef2f2",
    borderRadius: 6,
    padding: "8px 12px",
    margin: 0,
  },
};
