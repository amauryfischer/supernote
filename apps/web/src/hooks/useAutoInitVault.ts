"use client";

/**
 * useAutoInitVault — formerly auto-opened the default vault under Electron.
 *
 * In PWA mode the vault is created/picked through the File System Access API
 * (user gesture required), so there's nothing to auto-initialise here.
 * The hook is kept as a no-op stub so existing call sites (e.g. the layout
 * banner) compile without churn.
 */

export interface AutoInitVaultState {
  isInitializing: boolean;
  error: string | null;
}

export function useAutoInitVault(): AutoInitVaultState {
  return { isInitializing: false, error: null };
}
