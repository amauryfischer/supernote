"use client";

import type { TemplateIpc } from "@supernote/ipc";
import { trpc, hasWorkerBackend } from "@/lib/trpc/client";
import { useWorkerReady } from "@/components/notes/hooks";
import { isDegradedVault } from "@/lib/pwa/PwaVaultSetup";

export interface TemplateListState {
  /** Faux en mode dégradé : aucun coffre, rien ne peut être enregistré. */
  hasBackend: boolean;
  templates: TemplateIpc[];
  isLoading: boolean;
  error: string | null;
}

export function useTemplateList(enabled = true): TemplateListState {
  const hasBackend = hasWorkerBackend() && !isDegradedVault();
  const workerReady = useWorkerReady();
  const query = trpc.templates.list.useQuery(
    { source: "all" },
    { enabled: enabled && hasBackend && workerReady },
  );
  return {
    hasBackend,
    templates: query.data ?? [],
    isLoading: hasBackend && (!workerReady || query.isLoading),
    error: query.error?.message ?? null,
  };
}
