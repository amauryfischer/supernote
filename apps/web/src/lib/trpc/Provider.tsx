"use client";

/**
 * TrpcProvider — wraps the app with:
 * - QueryClient (TanStack Query v5)
 * - trpc.Provider (tRPC React Query adapter)
 *
 * Must be used inside a client component boundary (already "use client").
 */

import { useEffect, useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { trpc, createTrpcReactClient } from "./client";
import { isWorkerReady } from "./browser-link";

interface TrpcProviderProps {
  readonly children: ReactNode;
}

export function TrpcProvider({ children }: TrpcProviderProps) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            gcTime: 5 * 60_000,
            retry: false,
            refetchOnWindowFocus: false,
          },
        },
      }),
  );

  const [trpcClient] = useState(() => createTrpcReactClient());

  // When the vault Web Worker becomes ready, retry every cached query +
  // invalidate so any UI that subscribed pre-init (and got "Vault not
  // initialized") refetches and surfaces fresh data. Mirrors the manual
  // refetch a user previously had to trigger via Ctrl+Shift+R.
  //
  // On a VAULT SWITCH (event.detail.wasReady === true) the cache must be
  // wiped, not just invalidated — the queries we'd refetch were keyed on
  // PREVIOUS vault state and their cached results (note lists, folder
  // trees, schemas, …) still belong to the old vault. `invalidateQueries`
  // alone would surface that stale payload while the refetch is in flight,
  // exactly the "I switched vaults and still see the old one" symptom.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const refresh = (ev?: Event) => {
      const isSwitch = (ev as CustomEvent | undefined)?.detail?.isSwitch === true;
      if (isSwitch) {
        // Vault switch: drop EVERY query's data AND force an immediate
        // refetch on active observers. `resetQueries({})` (empty filter =
        // all queries) clears data and re-triggers fetches; `removeQueries`
        // alone would clear cache but observers keep their stale snapshot
        // until their next mount, which is why the sidebar still showed
        // the previous vault's folders post-switch.
        void queryClient.resetQueries({});
        return;
      }
      // First boot / re-grant: reset error queries so `enabled` queries
      // that errored will refetch even if not "stale" yet (errors don't
      // expire on time), then invalidate the rest.
      queryClient.resetQueries({
        predicate: (q) => q.state.status === "error",
      });
      void queryClient.invalidateQueries();
    };
    // Cover the race where the worker emitted VAULT_READY BEFORE the
    // Provider mounted its listener (single full-page VAULT_READY arrives
    // synchronously after init, often before any React effects run). If the
    // worker is already up at mount time, refresh immediately.
    if (isWorkerReady()) refresh();
    // Also re-invalidate when the worker reports background-reindex progress
    // (orphan files adopted, phantom rows swept). VAULT_READY fires BEFORE
    // reindex runs, so the first refresh only sees the freshly-hydrated DB;
    // without this follow-up, the sidebar wouldn't show the newly adopted
    // folders until the next manual reload.
    const onProgress = () => {
      void queryClient.invalidateQueries();
    };
    window.addEventListener("supernote:vault-ready", refresh);
    window.addEventListener("supernote:index-progress", onProgress);
    return () => {
      window.removeEventListener("supernote:vault-ready", refresh);
      window.removeEventListener("supernote:index-progress", onProgress);
    };
  }, [queryClient]);

  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </trpc.Provider>
  );
}
