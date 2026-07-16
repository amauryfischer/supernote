"use client";

/**
 * Squelettes de chargement partagés des vues Bases (Gallery / List / Kanban).
 *
 * Avant, chaque vue affichait son propre « Chargement… » texte — spinner
 * déguisé qui contredit le ressenti local-first et fragmente la grammaire.
 * Ces squelettes reflètent la forme réelle du contenu à venir (carte, ligne)
 * pour que le chargement se ressente instantané et cohérent d'une vue à l'autre.
 */

import { Skeleton } from "@supernote/ui";

/** Squelette d'une EntityCard (Gallery / Kanban) : titre + 2 champs. */
export function EntityCardSkeleton() {
  return (
    <div
      className="flex flex-col gap-2 rounded-md border p-3"
      style={{ backgroundColor: "var(--surface-1)", borderColor: "var(--border-subtle)" }}
    >
      <Skeleton className="h-4 w-3/4" />
      <Skeleton className="h-3 w-1/2" />
      <Skeleton className="h-3 w-2/5" />
    </div>
  );
}

/** Grille de cartes squelette — même gabarit que la grille Gallery. */
export function CardGridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div
      className="grid gap-3"
      style={{ gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))" }}
    >
      {Array.from({ length: count }, (_, i) => (
        <EntityCardSkeleton key={i} />
      ))}
    </div>
  );
}

/** Lignes squelette — même gabarit que les lignes List. */
export function ListRowsSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="flex flex-col gap-2 p-3">
      {Array.from({ length: count }, (_, i) => (
        <div
          key={i}
          className="flex items-center justify-between gap-3 rounded-md border px-3 py-2.5"
          style={{ backgroundColor: "var(--surface-1)", borderColor: "var(--border-subtle)" }}
        >
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <Skeleton className="h-3.5 w-1/2" />
            <Skeleton className="h-3 w-1/4" />
          </div>
          <Skeleton className="h-3 w-16" />
        </div>
      ))}
    </div>
  );
}
