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
  persist: (markdown: string) => Promise<void>;
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

  // Comble la fenêtre PRÉCÉDENTE : entre "create dispatché" et "create
  // résolu". Sans ça, deux persist() coup sur coup avant réponse du premier
  // create (ex. l'auto-save à 1000ms puis un Ctrl+S juste après) partent
  // tous les deux en `create` faute d'id connu, et dupliquent l'entité
  // `daily` du jour. Le markdown le plus récent arrivé pendant qu'un create
  // est en vol est mis en attente (dernier gagne, jamais perdu) et rejoué en
  // `update` une fois l'id connu.
  const creatingRef = useRef(false);
  const pendingMarkdownRef = useRef<string | null>(null);
  const pendingPromiseRef = useRef<Promise<void> | null>(null);

  const createMutation = trpc.entities.create.useMutation();
  const updateMutation = trpc.entities.update.useMutation();

  const persist = useCallback(
    (markdown: string): Promise<void> => {
      const id = existing?.id ?? createdIdRef.current;
      if (id) {
        return updateMutation.mutateAsync({ id, body: markdown }).then(() => undefined);
      }

      if (creatingRef.current) {
        pendingMarkdownRef.current = markdown;
        return pendingPromiseRef.current ?? Promise.resolve();
      }

      creatingRef.current = true;
      pendingMarkdownRef.current = null;
      const promise = createMutation
        .mutateAsync({ typeId: DAILY_TYPE_ID, fields: { date }, body: markdown })
        .then((created) => {
          createdIdRef.current = created.id;
          void utils.entities.list.invalidate({ typeId: DAILY_TYPE_ID });
          const pending = pendingMarkdownRef.current;
          pendingMarkdownRef.current = null;
          if (pending === null) return undefined;
          // Une frappe est arrivée pendant le create — la rejouer avec le
          // markdown le plus frais plutôt que la considérer sauvegardée.
          return updateMutation.mutateAsync({ id: created.id, body: pending }).then(() => undefined);
        })
        .finally(() => {
          creatingRef.current = false;
          pendingPromiseRef.current = null;
        });
      pendingPromiseRef.current = promise;
      return promise;
    },
    [existing, date, createMutation, updateMutation, utils],
  );

  return {
    entityId: existing?.id ?? createdIdRef.current,
    initialMarkdown: existing?.body ?? buildTemplateMarkdown(date),
    isLoading: listQuery.isLoading,
    persist,
  };
}
