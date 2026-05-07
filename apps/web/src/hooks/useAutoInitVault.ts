"use client";

/**
 * useAutoInitVault — ensures a default vault exists on first launch.
 *
 * Flow:
 *   1. Query `vault.getCurrent` (cheap, cached).
 *   2. If the result is null and we're in Electron (IPC available):
 *      mutate `vault.open` with the default vault path.
 *      `vault.open` creates the directory and DB if they don't exist.
 *   3. Returns `{ isInitializing, error }` for the banner in layout.tsx.
 *
 * In browser dev mode the query will error (IPC unavailable). We treat that
 * as "no vault" but skip the mutation to avoid cascading errors.
 */

import { useEffect, useRef } from "react";
import { trpc } from "@/lib/trpc/client";
import { DEFAULT_VAULT_PATH } from "@/lib/vault/auto-init";

export interface AutoInitVaultState {
  isInitializing: boolean;
  error: string | null;
  isElectron: boolean;
}

export function useAutoInitVault(): AutoInitVaultState {
  const isElectron =
    typeof window !== "undefined" && Boolean(window.__supernoteIPC);

  const currentVaultQuery = trpc.vault.getCurrent.useQuery(undefined, {
    enabled: isElectron,
    retry: false,
  });

  const openMutation = trpc.vault.open.useMutation();
  const hasTriggered = useRef(false);

  useEffect(() => {
    if (hasTriggered.current) return;
    if (!isElectron) return;
    if (currentVaultQuery.isLoading) return;
    if (currentVaultQuery.isError) return;
    if (currentVaultQuery.data !== null) return;

    hasTriggered.current = true;
    openMutation.mutate({ path: DEFAULT_VAULT_PATH });
  }, [
    isElectron,
    currentVaultQuery.isLoading,
    currentVaultQuery.isError,
    currentVaultQuery.data,
    openMutation,
  ]);

  const isInitializing =
    isElectron &&
    (currentVaultQuery.isLoading ||
      (currentVaultQuery.data === null && openMutation.isPending));

  const error =
    openMutation.isError
      ? (openMutation.error?.message ?? "Erreur lors de la création du vault")
      : null;

  return { isInitializing, error, isElectron };
}
