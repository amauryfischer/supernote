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
 *   "Continuer sans dossier" → degraded localStorage mode
 */

import React, { useEffect, useState, useCallback } from "react";
import { saveVaultHandle, loadVaultHandle, verifyHandlePermission } from "@/lib/vault-worker/vault-handle-storage";
import { initWorkerVault, onWorkerMessage, setWorkerReady } from "@/lib/trpc/browser-link";
import { isBrowserPwaMode } from "@/lib/trpc/client";
import type { VaultReadyMessage, VaultErrorMessage } from "@/lib/vault-worker/worker-protocol";

type SetupState =
  | "idle"        // Checking for existing handle
  | "checking"    // Verifying stored handle permission
  | "ready"       // Vault is initialized
  | "prompt"      // Show the welcome modal
  | "picking"     // showDirectoryPicker in progress
  | "loading"     // Worker initializing
  | "error"       // Init failed
  | "degraded";   // User chose localStorage mode

export function usePwaVaultSetup() {
  const [state, setState] = useState<SetupState>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [vaultName, setVaultName] = useState<string | null>(null);

  // Only runs in PWA mode (FSA available, no Electron)
  const isPwa = isBrowserPwaMode();

  useEffect(() => {
    if (!isPwa) { setState("ready"); return; }

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
      setState("loading");
      startWorker(handle);
    } catch (err) {
      // User cancelled
      if ((err as Error).name === "AbortError") {
        setState("prompt");
      } else {
        setErrorMsg(String(err));
        setState("error");
      }
    }
  }, []);

  const skipToDegraded = useCallback(() => {
    setState("degraded");
  }, []);

  return { state, errorMsg, vaultName, pickFolder, skipToDegraded, isPwa };
}

function startWorker(handle: FileSystemDirectoryHandle): void {
  initWorkerVault(handle);
}

// ── UI Component ──────────────────────────────────────────────────────────────

export function PwaVaultSetup({ children }: { children: React.ReactNode }) {
  const { state, errorMsg, vaultName, pickFolder, skipToDegraded, isPwa } = usePwaVaultSetup();

  // Not PWA mode, or already ready/degraded — render children directly
  if (!isPwa || state === "ready" || state === "degraded" || state === "idle") {
    return <>{children}</>;
  }

  // While checking stored handle, show children (avoids flash)
  if (state === "checking") {
    return <>{children}</>;
  }

  // Worker is loading
  if (state === "loading") {
    return (
      <>
        {children}
        <PwaOverlay>
          <LoadingSpinner />
          <p style={styles.subtitle}>Ouverture du vault...</p>
        </PwaOverlay>
      </>
    );
  }

  // Error state
  if (state === "error") {
    return (
      <>
        {children}
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
      </>
    );
  }

  // Welcome prompt (first launch or permission revoked)
  return (
    <>
      {children}
      <PwaOverlay>
        <div style={styles.logo}>S</div>
        <h1 style={styles.title}>Bienvenue sur Supernote</h1>
        <p style={styles.subtitle}>
          Pour stocker vos notes localement et les retrouver à chaque visite,
          choisissez un dossier sur votre disque.
        </p>
        <ul style={styles.featureList}>
          <li>Fichiers <code>.md</code> dans votre dossier — pas de lock-in</li>
          <li>SQLite local — aucune donnée n'est envoyée sur un serveur</li>
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
    </>
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
