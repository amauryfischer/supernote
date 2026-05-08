"use client";

/**
 * VaultInitBanner — formerly displayed during Electron vault auto-init.
 *
 * In PWA mode, vault initialization is a user-gesture-driven flow handled
 * elsewhere; there is no background "creating default vault" phase to
 * announce. Kept as a no-op render so the layout doesn't need editing.
 */

import { useAutoInitVault } from "@/hooks/useAutoInitVault";

export function VaultInitBanner() {
  const { isInitializing, error } = useAutoInitVault();

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
      {error ? `Erreur vault : ${error}` : "Initialisation du vault…"}
    </div>
  );
}
