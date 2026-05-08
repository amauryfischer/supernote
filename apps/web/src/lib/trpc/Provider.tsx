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
  useEffect(() => {
    if (typeof window === "undefined") return;
    const refresh = () => {
      // Reset error queries so `enabled` queries that errored will refetch
      // even if they're not currently "stale" (errors don't expire on time).
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
    window.addEventListener("supernote:vault-ready", refresh);
    return () => window.removeEventListener("supernote:vault-ready", refresh);
  }, [queryClient]);

  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </trpc.Provider>
  );
}
