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
import { useQueryClient, type QueryKey } from "@tanstack/react-query";
import { getQueryKey } from "@trpc/react-query";
import { useToast } from "@supernote/ui";
import { trpc } from "@/lib/trpc/client";
import type { EntityType, Field } from "@supernote/core";
import type { View, FilterClause, SortClause } from "@supernote/ipc";
import { isCodaBase } from "@/lib/coda/bindings";

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
    // Inspect le cache d'abord — si une vue système existe déjà, no-op.
    // Évite un burst de N mutations quand une note contient N blocs
    // `databaseView` qui pointent vers la même Base.
    const cached = utils.views.list.getData({ typeId });
    if (cached && cached.some((v) => v.isSystem)) return;
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

/**
 * A grid row as cached by `views.queryForView`. Extra (derived) fields ride
 * along under the index signature so optimistic spreads preserve them.
 */
type RowEntity = {
  id: string;
  typeId: string;
  filePath?: string;
  fields: Record<string, unknown>;
  body?: string;
  createdAt: string;
  updatedAt: string;
  [k: string]: unknown;
};
type ViewData = { items: RowEntity[] };
type RowSnapshot = [QueryKey, ViewData | undefined];
type MutContext = { snaps: RowSnapshot[] };

/** Mutations on entities (rows) that propagate to every open view.
 *
 * Writes are OPTIMISTIC: `onMutate` patches every cached `views.queryForView`
 * result for this Base in place (insert / merge / remove) so the grid reacts
 * instantly with zero round-trip flicker — Notion-style. `onError` rolls the
 * snapshots back; `onSettled` reconciles against the worker (derived fields,
 * sort order) without a visible reflow since rows keep identity by id. */
export function useEntityMutations(typeId: string | undefined) {
  const utils = trpc.useUtils();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // Prefix that matches EVERY queryForView cache regardless of filters/sorts —
  // a Base can be open in several views/inline blocks at once; all must update.
  const viewsPrefix = getQueryKey(trpc.views.queryForView);

  /** Patch all queryForView caches for `typeId`; return snapshots for rollback. */
  const patchRows = (fn: (rows: RowEntity[]) => RowEntity[]): RowSnapshot[] => {
    if (!typeId) return [];
    const snaps: RowSnapshot[] = [];
    for (const [key, data] of queryClient.getQueriesData<ViewData>({ queryKey: viewsPrefix })) {
      const input = (key as [unknown, { input?: { typeId?: string } }])?.[1]?.input;
      if (!input || input.typeId !== typeId) continue;
      snaps.push([key, data]);
      if (data && Array.isArray(data.items)) {
        queryClient.setQueryData<ViewData>(key, { ...data, items: fn(data.items) });
      }
    }
    return snaps;
  };
  const rollback = (ctx: MutContext | undefined) => {
    if (!ctx) return;
    for (const [key, data] of ctx.snaps) queryClient.setQueryData(key, data);
  };
  const reconcile = () => {
    void utils.views.queryForView.invalidate();
    void utils.entities.list.invalidate();
  };

  const create = trpc.entities.create.useMutation({
    onMutate: async (vars): Promise<MutContext> => {
      await utils.views.queryForView.cancel();
      const ts = new Date().toISOString();
      const optimistic: RowEntity = {
        id: `__opt_${ts}_${Math.round(performance.now())}`,
        typeId: vars.typeId,
        filePath: "",
        body: vars.body ?? "",
        fields: (vars.fields ?? {}) as Record<string, unknown>,
        createdAt: ts,
        updatedAt: ts,
      };
      // Sorted by createdAt ASC server-side → fresh row lands at the bottom.
      return { snaps: patchRows((rows) => [...rows, optimistic]) };
    },
    onError: (_e, _v, ctx) => rollback(ctx),
    onSettled: reconcile,
  });

  const update = trpc.entities.update.useMutation({
    onMutate: async (vars): Promise<MutContext> => {
      await utils.views.queryForView.cancel();
      const ts = new Date().toISOString();
      // Mirror the worker's merge semantics: { ...existingFields, ...patch }.
      return {
        snaps: patchRows((rows) =>
          rows.map((r) =>
            r.id === vars.id
              ? {
                  ...r,
                  fields: { ...r.fields, ...(vars.fields ?? {}) },
                  body: vars.body ?? r.body,
                  updatedAt: ts,
                }
              : r,
          ),
        ),
      };
    },
    onError: (_e, _v, ctx) => rollback(ctx),
    onSettled: reconcile,
  });

  const del = trpc.entities.delete.useMutation({
    onMutate: async (vars): Promise<MutContext> => {
      await utils.views.queryForView.cancel();
      return { snaps: patchRows((rows) => rows.filter((r) => r.id !== vars.id)) };
    },
    onError: (_e, _v, ctx) => rollback(ctx),
    onSettled: reconcile,
  });

  // A Coda-mirrored base is read-only: block every write at the single
  // chokepoint every view goes through, so no view kind (grid, kanban, form…)
  // can mutate its data. The schema has no native read-only flag; the binding
  // registry is the source of truth (cf. mounts, also an app-level invariant).
  const readOnly = typeof typeId === "string" && typeId.length > 0 && isCodaBase(typeId);
  if (!readOnly) return { create, update, delete: del, typeId, readOnly: false };

  const blocked = {
    mutate: () => toast({ title: "Base Coda en lecture seule", variant: "danger" }),
    mutateAsync: async () => {
      toast({ title: "Base Coda en lecture seule", variant: "danger" });
      return undefined;
    },
  };
  return {
    create: { ...create, ...blocked } as unknown as typeof create,
    update: { ...update, ...blocked } as unknown as typeof update,
    delete: { ...del, ...blocked } as unknown as typeof del,
    typeId,
    readOnly: true,
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

// ── Recherche instantanée (loupe de la toolbar) ───────────────────────────

/**
 * Texte "cherchable" d'une valeur de champ, tel que l'utilisateur le voit.
 * Pour select / multiselect / status on matche le LABEL des options (pas la
 * value interne) — chercher « En cours » doit trouver la chip « En cours »
 * même si la value stockée est `in_progress`.
 */
function fieldSearchText(field: Field, raw: unknown): string {
  if (
    field.kind === "select" ||
    field.kind === "multiselect" ||
    field.kind === "status"
  ) {
    const labelOf = (v: unknown): string => {
      const s = String(v);
      return field.options.find((o) => o.value === s)?.label ?? s;
    };
    return Array.isArray(raw) ? raw.map(labelOf).join(" ") : labelOf(raw);
  }
  if (Array.isArray(raw)) {
    return raw
      .map((v) => (v !== null && typeof v === "object" ? JSON.stringify(v) : String(v)))
      .join(" ");
  }
  if (raw !== null && typeof raw === "object") return JSON.stringify(raw);
  return String(raw);
}

/**
 * `true` si `query` (insensible à la casse) apparaît dans au moins une des
 * valeurs stringifiées des champs `fields` de l'entité. Une query vide
 * matche tout. Purement client-side — aucun round-trip worker.
 */
export function matchesQuery(
  entity: { fields: Record<string, unknown> },
  fields: readonly Field[],
  query: string,
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  for (const field of fields) {
    const raw = entity.fields[field.id];
    if (raw === null || raw === undefined || raw === "") continue;
    if (fieldSearchText(field, raw).toLowerCase().includes(q)) return true;
  }
  return false;
}

/**
 * Filtre les items d'une vue par la recherche instantanée, en ne matchant
 * que les champs VISIBLES de la vue (même résolution que le rendu). Opère
 * sur le cache `queryForView` existant, mémoïsé pour ne recalculer que
 * quand items / vue / query changent.
 */
export function useSearchFilter<T extends { fields: Record<string, unknown> }>(
  items: T[],
  base: EntityType,
  view: Pick<View, "visibleFields" | "hiddenFields">,
  query: string | undefined,
): T[] {
  return useMemo(() => {
    const q = (query ?? "").trim();
    if (!q) return items;
    const visibleIds = new Set(
      resolveVisibleFieldIds(view, base.fields.map((f) => f.id)),
    );
    const visibleFields = base.fields.filter((f) => visibleIds.has(f.id));
    return items.filter((e) => matchesQuery(e, visibleFields, q));
  }, [items, base.fields, view, query]);
}
