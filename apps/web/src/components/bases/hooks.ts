/**
 * React Query hooks for the Bases feature (Coda/Notion-style databases).
 *
 * - `useViews(typeId)` — list saved views of a Base
 * - `useEnsureDefaultView(typeId)` — auto-creates the system view on first visit
 * - `useEntitiesForView(view)` — query entities matching a view's filters/sorts
 * - `useViewMutations()` — create/update/delete view
 * - `useEntityMutations()` — create/update/delete entity (cells edits go through here)
 */

import { useEffect, useMemo } from "react";
import { trpc } from "@/lib/trpc/client";
import type { View, FilterClause, SortClause } from "@supernote/ipc";

export function useViews(typeId: string | undefined) {
  return trpc.views.list.useQuery(
    { typeId: typeId ?? "" },
    { enabled: !!typeId, staleTime: 30_000 },
  );
}

/**
 * Hook variant of `views.ensureDefault` — fires the mutation once when the
 * component mounts with a typeId, then refetches the list. Returns nothing —
 * just makes sure the default view exists before the caller reads it.
 */
export function useEnsureDefaultView(typeId: string | undefined): void {
  const utils = trpc.useUtils();
  const mut = trpc.views.ensureDefault.useMutation({
    onSuccess: () => {
      void utils.views.list.invalidate();
    },
  });
  useEffect(() => {
    if (!typeId) return;
    mut.mutate({ typeId });
    // mut intentionally excluded — we only want to fire on typeId change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typeId]);
}

export function useEntitiesForView(
  typeId: string | undefined,
  filters: FilterClause[],
  sorts: SortClause[],
) {
  return trpc.views.queryForView.useQuery(
    { typeId: typeId ?? "", filters, sorts },
    { enabled: !!typeId, staleTime: 5_000 },
  );
}

/** Mutations for a view's settings (rename, kind, filters, sorts, visibleFields…). */
export function useViewMutations() {
  const utils = trpc.useUtils();
  const refresh = () => {
    void utils.views.list.invalidate();
    void utils.views.get.invalidate();
  };
  return {
    create: trpc.views.create.useMutation({ onSuccess: refresh }),
    update: trpc.views.update.useMutation({ onSuccess: refresh }),
    delete: trpc.views.delete.useMutation({ onSuccess: refresh }),
  };
}

/** Mutations on entities (rows) that propagate to every open view. */
export function useEntityMutations(typeId: string | undefined) {
  const utils = trpc.useUtils();
  const refresh = () => {
    void utils.views.queryForView.invalidate();
    void utils.entities.list.invalidate();
  };
  return {
    create: trpc.entities.create.useMutation({ onSuccess: refresh }),
    update: trpc.entities.update.useMutation({ onSuccess: refresh }),
    delete: trpc.entities.delete.useMutation({ onSuccess: refresh }),
    typeId,
  };
}

/**
 * Compute the ordered list of visible field IDs for a view.
 *
 * Rules:
 *   1. If `view.visibleFields` is non-empty, use it as-is — that's the user's
 *      explicit ordering.
 *   2. Otherwise, fall back to the EntityType's declared field order, minus
 *      anything explicitly hidden via `view.hiddenFields`.
 *
 * Callers pass the EntityType's `fields` array (already mapped to core Field
 * type) so we can read field ids in declaration order.
 */
export function resolveVisibleFieldIds(
  view: Pick<View, "visibleFields" | "hiddenFields">,
  allFieldIds: string[],
): string[] {
  if (view.visibleFields.length > 0) return view.visibleFields;
  const hidden = new Set(view.hiddenFields);
  return allFieldIds.filter((id) => !hidden.has(id));
}

/**
 * Stable identity helper so a memoized component sees the same array
 * reference across re-renders when the contents are equal.
 */
export function useStableArray<T>(arr: T[]): T[] {
  return useMemo(() => arr, [JSON.stringify(arr)]);
}
