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
 * Bookkeeping d'un create `daily` en vol, pour UNE date. `JournalEditor`
 * n'est jamais remonté au changement de date (seul `<SupernoteEditor
 * key={date}>` l'est) — des refs simples sur le hook fuiraient donc d'une
 * date à l'autre : le create de la date A resterait "en vol" pendant qu'on
 * navigue vers B, et le markdown de B serait flushé sur l'entité de A.
 */
interface DateOpState {
  creating: boolean;
  pendingMarkdown: string | null;
  pendingPromise: Promise<void> | null;
  createdId: string | null;
}

function getOrCreateState(states: Map<string, DateOpState>, date: string): DateOpState {
  let state = states.get(date);
  if (!state) {
    state = { creating: false, pendingMarkdown: null, pendingPromise: null, createdId: null };
    states.set(date, state);
  }
  return state;
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

  // Une entrée par date visitée dans cette session d'édition — voir
  // DateOpState ci-dessus pour le pourquoi de la Map plutôt que des refs.
  const opStatesRef = useRef<Map<string, DateOpState>>(new Map());

  const createMutation = trpc.entities.create.useMutation();
  // `initialMarkdown` lit `existing?.body` depuis CE cache — sans patch au
  // succès, le body y restait figé sur le dernier create/refetch (seul le
  // chemin create invalidait) et une navigation A→B→A ré-affichait un
  // contenu périmé que la frappe suivante écrasait pour de bon. Patché en
  // place plutôt qu'invalidate : un invalidate à chaque debounce d'1s
  // referait un aller-retour sur la liste typeId=daily entière (limit 5000).
  const updateMutation = trpc.entities.update.useMutation({
    onSuccess: (updated) => {
      utils.entities.list.setData(
        { typeId: DAILY_TYPE_ID, limit: DAILY_LIMIT, offset: 0 },
        (old) =>
          old
            ? { ...old, items: old.items.map((item) => (item.id === updated.id ? updated : item)) }
            : old,
      );
    },
  });

  const persist = useCallback(
    (markdown: string): Promise<void> => {
      const state = getOrCreateState(opStatesRef.current, date);
      const id = existing?.id ?? state.createdId;
      if (id) {
        return updateMutation.mutateAsync({ id, body: markdown }).then(() => undefined);
      }

      if (state.creating) {
        // `creating` et `pendingPromise` sont posés dans le même tick
        // synchrone plus bas, jamais observables séparément — pendingPromise
        // est donc garanti non-null ici.
        state.pendingMarkdown = markdown;
        return state.pendingPromise!;
      }

      state.creating = true;
      state.pendingMarkdown = null;
      const promise = createMutation
        .mutateAsync({ typeId: DAILY_TYPE_ID, fields: { date }, body: markdown })
        .then((created) => {
          state.createdId = created.id;
          void utils.entities.list.invalidate({ typeId: DAILY_TYPE_ID });
          const pending = state.pendingMarkdown;
          state.pendingMarkdown = null;
          if (pending === null) return undefined;
          // Une frappe est arrivée pendant le create — la rejouer avec le
          // markdown le plus frais plutôt que la considérer sauvegardée.
          return updateMutation.mutateAsync({ id: created.id, body: pending }).then(() => undefined);
        })
        .finally(() => {
          state.creating = false;
          state.pendingPromise = null;
        });
      state.pendingPromise = promise;
      return promise;
    },
    [existing, date, createMutation, updateMutation, utils],
  );

  return {
    entityId: existing?.id ?? opStatesRef.current.get(date)?.createdId ?? null,
    initialMarkdown: existing?.body ?? buildTemplateMarkdown(date),
    isLoading: listQuery.isLoading,
    persist,
  };
}
