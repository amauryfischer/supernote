"use client";

/**
 * VaultInitBanner — discreet top-of-page status banner shown while the
 * default vault is being created on first launch.
 *
 * Appears only in Electron when no vault is open yet.
 * Fades out automatically once initialization completes.
 */

import { useAutoInitVault } from "@/hooks/useAutoInitVault";

export function VaultInitBanner() {
  const { isInitializing, error, isElectron } = useAutoInitVault();

  if (!isElectron) return null;
  if (!isInitializing && !error) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        zIndex: 9999,
        padding: "6px 16px",
        fontSize: "11px",
        textAlign: "center",
        backgroundColor: error ? "var(--color-error, #ef4444)" : "var(--accent, #6366f1)",
        color: "#fff",
        opacity: 0.92,
      }}
    >
      {error
        ? `Erreur vault : ${error}`
        : "Création du vault par défaut…"}
    </div>
  );
}
