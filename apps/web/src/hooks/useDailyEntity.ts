"use client";

import { useCallback, useMemo, useRef } from "react";
import { trpc } from "@/lib/trpc/client";
import { toYmdKey } from "./journal-dates";
import { DAILY_JOURNAL } from "@supernote/templates";

const DAILY_TYPE_ID = "daily";
const DAILY_LIMIT = 5000;

function buildTemplateMarkdown(date: string): string {
  const d = new Date(date + "T12:00:00");
  const formatted = d.toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  return DAILY_JOURNAL.body
    .replace(/\{\{date:[^}]+\}\}/g, formatted)
    .replace(/\{\{cursor\}\}/g, "");
}

interface UseDailyEntityResult {
  entityId: string | null;
  initialMarkdown: string;
  isLoading: boolean;
  persist: (markdown: string) => void;
}

/**
 * Trouve ou prépare l'entité `daily` d'une date donnée. Réutilise la même
 * requête que `useDatesWithNote` (typeId=daily, limite large) plutôt que
 * d'ajouter une procédure IPC dédiée à une seule date.
 */
export function useDailyEntity(date: string): UseDailyEntityResult {
  const utils = trpc.useUtils();
  const listQuery = trpc.entities.list.useQuery(
    { typeId: DAILY_TYPE_ID, limit: DAILY_LIMIT, offset: 0 },
    { staleTime: 30_000 },
  );

  const existing = useMemo(() => {
    for (const item of listQuery.data?.items ?? []) {
      if (toYmdKey(item.fields?.["date"]) === date) return item;
    }
    return null;
  }, [listQuery.data, date]);

  // Comble la fenêtre entre "create a réussi" et "le refetch a vu la
  // nouvelle entité" : sans ça, deux persist() rapprochés avant refetch
  // créeraient deux entités `daily` pour la même date.
  const createdIdRef = useRef<string | null>(null);

  const createMutation = trpc.entities.create.useMutation({
    onSuccess: (created) => {
      createdIdRef.current = created.id;
      void utils.entities.list.invalidate({ typeId: DAILY_TYPE_ID });
    },
  });
  const updateMutation = trpc.entities.update.useMutation();

  const persist = useCallback(
    (markdown: string) => {
      const id = existing?.id ?? createdIdRef.current;
      if (id) {
        void updateMutation.mutateAsync({ id, body: markdown });
      } else {
        void createMutation.mutateAsync({
          typeId: DAILY_TYPE_ID,
          fields: { date },
          body: markdown,
        });
      }
    },
    [existing, date, createMutation, updateMutation],
  );

  return {
    entityId: existing?.id ?? createdIdRef.current,
    initialMarkdown: existing?.body ?? buildTemplateMarkdown(date),
    isLoading: listQuery.isLoading,
    persist,
  };
}
