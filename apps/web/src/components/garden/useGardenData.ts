"use client";

/**
 * useGardenData — combine la liste des notes (entities.list) et le comptage
 * agrégé des backlinks (entities.backlinkCounts) en une collection de Plant.
 */

import { useMemo } from "react";
import { trpc } from "@/lib/trpc/client";
import { toPlant, plantingOrder, type Plant } from "@/lib/garden/plantMath";

export interface UseGardenDataResult {
  plants: Plant[];
  isLoading: boolean;
}

export function useGardenData(): UseGardenDataResult {
  const notesQuery = trpc.entities.list.useQuery(
    { typeId: "note", limit: 10000, offset: 0 },
    { staleTime: 5 * 60_000 },
  );
  const countsQuery = trpc.entities.backlinkCounts.useQuery(undefined, {
    staleTime: 5 * 60_000,
  });

  const plants = useMemo(() => {
    const items = notesQuery.data?.items ?? [];
    const counts = countsQuery.data?.counts ?? {};
    // now() figé au render — déterministe pour ce cycle (les notes ne
    // bougent pas d'un stade à la milliseconde près).
    const now = Date.now();
    const built = items.map((e) => {
      const title =
        typeof e.fields["title"] === "string" && e.fields["title"]
          ? (e.fields["title"] as string)
          : e.filePath.split("/").pop()?.replace(/\.md$/, "") ?? "Sans titre";
      return toPlant(
        {
          id: e.id,
          title,
          updatedAt: e.updatedAt,
          createdAt: e.createdAt,
          backlinks: counts[e.id] ?? 0,
        },
        now,
      );
    });
    return plantingOrder(built);
  }, [notesQuery.data, countsQuery.data]);

  return { plants, isLoading: notesQuery.isLoading || countsQuery.isLoading };
}
