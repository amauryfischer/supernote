"use client";

/**
 * useHabitsSource — résout la liste d'habitudes et les opérations CRUD selon
 * le mode de la session (même découpage que `useContactsSource`) :
 *
 *   - mode "live"     : vault monté (ou Electron) → tRPC vers le vault worker.
 *   - mode "fallback" : mode dégradé « Aucun vault » → localStore (localStorage).
 *
 * Sans ce fallback, le mode dégradé gèle tout : le worker n'est jamais INIT,
 * `browser-link` met les requêtes en queue jusqu'au timeout 15 s
 * (`RPC timeout after 15000ms: entities.create`) et rien ne s'enregistre.
 * Le discriminant est l'ÉTAT du vault (`useVault().state === "degraded"`),
 * pas la capacité FSA du navigateur — Chrome sans vault choisi doit tomber
 * en fallback, pas geler.
 */

import { useCallback, useMemo } from "react";
import { trpc, trpcVanillaClient } from "@/lib/trpc/client";
import { useVault } from "@/lib/pwa/PwaVaultSetup";
import { localStore, useLocalEntities } from "@/lib/local-store";
import { HABIT_TYPE_ID, parseHabit, type Habit } from "@/lib/habits/habitData";
import type { FieldValue } from "@supernote/ipc";

export type HabitsSourceMode = "live" | "fallback";

export interface HabitsSource {
  habits: Habit[];
  mode: HabitsSourceMode;
  isLoading: boolean;
  createHabit: (fields: Record<string, FieldValue>) => Promise<void>;
  /** Merge partiel sur `fields` (le reste de l'entité est conservé). */
  updateHabitFields: (id: string, fields: Record<string, FieldValue>) => Promise<void>;
  removeHabit: (id: string) => Promise<void>;
}

export function useHabitsSource(): HabitsSource {
  const vault = useVault();
  // Seul le mode dégradé explicite bascule en localStore. Les autres états
  // PWA pré-vault ("checking", "loading", …) restent sur tRPC : browser-link
  // met les requêtes en queue et les rejoue dès VAULT_READY.
  const degraded = Boolean(vault?.isPwa && vault.state === "degraded");

  const utils = trpc.useUtils();
  const localEntities = useLocalEntities(HABIT_TYPE_ID);

  const query = trpc.entities.list.useQuery(
    { typeId: HABIT_TYPE_ID, limit: 1000, offset: 0 },
    { staleTime: 30_000, refetchOnMount: "always", enabled: !degraded, retry: false },
  );

  const habits = useMemo<Habit[]>(() => {
    const items = degraded ? localEntities : (query.data?.items ?? []);
    return items
      .map((e) => parseHabit(e))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }, [degraded, localEntities, query.data]);

  const createHabit = useCallback(
    async (fields: Record<string, FieldValue>) => {
      if (degraded) {
        localStore.create(HABIT_TYPE_ID, fields);
        return;
      }
      await trpcVanillaClient.entities.create.mutate({ typeId: HABIT_TYPE_ID, fields });
      await utils.entities.list.invalidate();
    },
    [degraded, utils],
  );

  const updateHabitFields = useCallback(
    async (id: string, fields: Record<string, FieldValue>) => {
      if (degraded) {
        // `localStore.update` remplace `fields` en bloc — merge manuel pour
        // garder le comportement patch-partiel du worker.
        const existing = localStore.get(id);
        if (!existing) throw new Error(`Habitude introuvable : ${id}`);
        localStore.update(id, { fields: { ...existing.fields, ...fields } });
        return;
      }
      await trpcVanillaClient.entities.update.mutate({ id, fields });
      await utils.entities.list.invalidate();
    },
    [degraded, utils],
  );

  const removeHabit = useCallback(
    async (id: string) => {
      if (degraded) {
        localStore.remove(id);
        return;
      }
      await trpcVanillaClient.entities.delete.mutate({ id });
      await utils.entities.list.invalidate();
    },
    [degraded, utils],
  );

  return {
    habits,
    mode: degraded ? "fallback" : "live",
    isLoading: !degraded && query.isLoading,
    createHabit,
    updateHabitFields,
    removeHabit,
  };
}
