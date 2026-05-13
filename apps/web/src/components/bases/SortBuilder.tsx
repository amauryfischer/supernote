"use client";

/**
 * SortBuilder — popover that edits the SortClause[] of a view.
 *
 * Multi-level sort: the first clause is the primary sort key, the second
 * disambiguates ties, etc. Up/down arrows reorder a clause; a per-row
 * direction toggle flips asc ⇄ desc; a × removes it. A trailing
 * "+ Ajouter un tri" inserts a new clause defaulting to the first unused
 * field of the schema.
 */

import { useEffect, useRef } from "react";
import { ArrowsDownUp, X, Plus, ArrowUp, ArrowDown, CaretUp, CaretDown } from "@phosphor-icons/react";
import type { EntityType, SortClause } from "@supernote/core";
import type { View } from "@supernote/ipc";
import { useViewMutations } from "./hooks";
import { labelForField } from "./filter-ops";

interface SortBuilderProps {
  base: EntityType;
  view: View;
  onClose: () => void;
}

export function SortBuilder({ base, view, onClose }: SortBuilderProps) {
  const { update } = useViewMutations();
  const popoverRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onDocMouseDown = (e: MouseEvent) => {
      if (!popoverRef.current) return;
      if (popoverRef.current.contains(e.target as Node)) return;
      onClose();
    };
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, [onClose]);

  const commit = (sorts: SortClause[]) => {
    update.mutate({ id: view.id, sorts: sorts as unknown as never });
  };

  const sorts = view.sorts as SortClause[];

  // Prefer fields not yet used in another sort clause so a fresh add doesn't
  // duplicate a sort by the same field (which would be a no-op anyway).
  const addSort = () => {
    const used = new Set(sorts.map((s) => s.fieldId));
    const freeField = base.fields.find((f) => !used.has(f.id)) ?? base.fields[0];
    if (!freeField) return;
    commit([...sorts, { fieldId: freeField.id, direction: "asc" }]);
  };

  const removeSort = (index: number) => {
    commit(sorts.filter((_, i) => i !== index));
  };

  const updateSort = (index: number, patch: Partial<SortClause>) => {
    commit(sorts.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  };

  const move = (index: number, delta: -1 | 1) => {
    const target = index + delta;
    if (target < 0 || target >= sorts.length) return;
    const next = [...sorts];
    const tmp = next[index]!;
    next[index] = next[target]!;
    next[target] = tmp;
    commit(next);
  };

  return (
    <div
      ref={popoverRef}
      className="absolute z-50 mt-1 rounded-lg border shadow-lg"
      style={{
        minWidth: 360,
        backgroundColor: "var(--surface-1)",
        borderColor: "var(--border-subtle)",
      }}
    >
      <div
        className="flex items-center gap-2 border-b px-3 py-2"
        style={{ borderColor: "var(--border-subtle)" }}
      >
        <ArrowsDownUp size={13} style={{ color: "var(--text-muted)" }} />
        <span
          className="text-xs font-semibold uppercase tracking-wide"
          style={{ color: "var(--text-muted)" }}
        >
          Tris
        </span>
        <span className="text-xs" style={{ color: "var(--text-muted)" }}>
          ({sorts.length})
        </span>
      </div>

      <div className="flex flex-col gap-1 px-3 py-2">
        {sorts.length === 0 && (
          <p
            className="py-2 text-center text-xs"
            style={{ color: "var(--text-muted)" }}
          >
            Aucun tri. Les entrées s'affichent dans l'ordre de modification.
          </p>
        )}
        {sorts.map((sort, index) => {
          const field = base.fields.find((f) => f.id === sort.fieldId) ?? base.fields[0];
          if (!field) return null;
          return (
            <div key={`${index}:${sort.fieldId}`} className="flex items-center gap-1">
              {/* Reorder buttons */}
              <div className="flex flex-col">
                <button
                  type="button"
                  onClick={() => move(index, -1)}
                  disabled={index === 0}
                  className="rounded p-0.5 hover:bg-[var(--surface-2)] disabled:opacity-30"
                  style={{ color: "var(--text-muted)" }}
                  title="Monter"
                >
                  <CaretUp size={10} />
                </button>
                <button
                  type="button"
                  onClick={() => move(index, 1)}
                  disabled={index === sorts.length - 1}
                  className="rounded p-0.5 hover:bg-[var(--surface-2)] disabled:opacity-30"
                  style={{ color: "var(--text-muted)" }}
                  title="Descendre"
                >
                  <CaretDown size={10} />
                </button>
              </div>

              {/* Field */}
              <select
                value={field.id}
                onChange={(e) => updateSort(index, { fieldId: e.target.value })}
                className="flex-1 rounded border bg-transparent px-1.5 py-1 text-xs"
                style={{
                  borderColor: "var(--border-subtle)",
                  color: "var(--text-primary)",
                }}
              >
                {base.fields.map((f) => (
                  <option key={f.id} value={f.id}>
                    {labelForField(f)}
                  </option>
                ))}
              </select>

              {/* Direction toggle */}
              <button
                type="button"
                onClick={() =>
                  updateSort(index, { direction: sort.direction === "asc" ? "desc" : "asc" })
                }
                className="flex items-center gap-1 rounded border px-1.5 py-1 text-xs hover:bg-[var(--surface-2)]"
                style={{
                  borderColor: "var(--border-subtle)",
                  color: "var(--text-secondary)",
                }}
                title={sort.direction === "asc" ? "Tri ascendant" : "Tri descendant"}
              >
                {sort.direction === "asc" ? <ArrowUp size={10} /> : <ArrowDown size={10} />}
                {sort.direction === "asc" ? "A→Z" : "Z→A"}
              </button>

              <button
                type="button"
                onClick={() => removeSort(index)}
                className="rounded p-1 hover:bg-[var(--surface-2)]"
                title="Supprimer le tri"
                style={{ color: "var(--text-muted)" }}
              >
                <X size={12} />
              </button>
            </div>
          );
        })}
      </div>

      <div
        className="border-t px-3 py-2"
        style={{ borderColor: "var(--border-subtle)" }}
      >
        <button
          type="button"
          onClick={addSort}
          className="flex items-center gap-1.5 rounded px-2 py-1 text-xs font-medium hover:bg-[var(--surface-2)]"
          style={{ color: "var(--text-secondary)" }}
        >
          <Plus size={11} /> Ajouter un tri
        </button>
      </div>
    </div>
  );
}
