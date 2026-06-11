"use client";

import { useMemo } from "react";
import { trpc } from "@/lib/trpc/client";
import { datesWithNoteFromEntities } from "./journal-dates";

/**
 * Identifiant du type d'entité « journal quotidien » semé par défaut
 * (cf. `apps/web/src/lib/vault-worker/seed-default-types.ts`). Chaque entrée de
 * journal est une entité `daily` portant un champ `date` (kind `date`).
 */
const DAILY_TYPE_ID = "daily";

/** Limite large : une année ≈ 365 entrées, on couvre plusieurs années en un round-trip. */
const DAILY_LIMIT = 5000;

interface UseDatesWithNoteResult {
  /** Ensemble des dates (`YYYY-MM-DD`) ayant une entrée de journal. */
  datesWithNote: Set<string>;
  /** La requête est en cours de chargement initial. */
  isLoading: boolean;
}

/**
 * Interroge les entrées de journal réelles (entités de type `daily`) et en
 * dérive l'ensemble des dates possédant une note, consommé par le calendrier
 * Journal (`JournalCalendar`).
 *
 * Dégrade proprement : si le backend ne supporte pas `entities.list`
 * (worker absent / coffre non monté), la requête échoue silencieusement et on
 * renvoie un ensemble vide plutôt que de fausses dates.
 */
export function useDatesWithNote(): UseDatesWithNoteResult {
  const query = trpc.entities.list.useQuery(
    { typeId: DAILY_TYPE_ID, limit: DAILY_LIMIT, offset: 0 },
    { staleTime: 30_000 },
  );

  const datesWithNote = useMemo(
    () => datesWithNoteFromEntities(query.data?.items ?? []),
    [query.data],
  );

  return { datesWithNote, isLoading: query.isLoading };
}
