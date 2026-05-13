"use client";

/**
 * DataGrid — Coda/Notion-style editable grid for a Base + View.
 *
 * One column per visible Field (resolved via view.visibleFields / hiddenFields).
 * One row per Entity returned by `views.queryForView`. Cell edits are
 * committed immediately via `entities.update`; the query is invalidated so
 * every other open view of the same Base re-renders.
 *
 * Phase 1: no virtualization, no multi-row selection, no column resizing.
 * Adding rows / columns is supported. Filters/sorts are honored if passed in
 * via `view` — the toolbar UI to edit them lives elsewhere.
 */

import { useMemo } from "react";
import { Plus, Trash } from "@phosphor-icons/react";
import type { EntityType, Field } from "@supernote/core";
import type { View } from "@supernote/ipc";
import { Cell } from "./Cell";
import { FieldKindBadge } from "@/components/schemas/FieldKindBadge";
import {
  useEntitiesForView,
  useEntityMutations,
  resolveVisibleFieldIds,
} from "./hooks";

interface DataGridProps {
  base: EntityType;
  view: View;
  /** Bounded height. The grid scrolls within it; the page handles the chrome. */
  maxHeight?: string;
}

export function DataGrid({ base, view, maxHeight }: DataGridProps) {
  const allFieldIds = useMemo(() => base.fields.map((f) => f.id), [base.fields]);
  const visibleIds = useMemo(
    () => resolveVisibleFieldIds(view, allFieldIds),
    [view, allFieldIds],
  );
  const fieldById = useMemo(() => {
    const m = new Map<string, Field>();
    for (const f of base.fields) m.set(f.id, f);
    return m;
  }, [base.fields]);

  const { data, isLoading, isError } = useEntitiesForView(
    base.id,
    view.filters,
    view.sorts,
  );
  const mut = useEntityMutations(base.id);

  const items = data?.items ?? [];

  const addRow = () => {
    mut.create.mutate({
      typeId: base.id,
      fields: {},
      body: "",
    });
  };

  return (
    <div
      className="overflow-auto"
      style={{
        maxHeight: maxHeight ?? "100%",
        backgroundColor: "var(--surface-0)",
      }}
    >
      <table className="w-full border-collapse text-sm">
        <thead
          className="sticky top-0 z-10"
          style={{ backgroundColor: "var(--surface-1)" }}
        >
          <tr>
            {/* Index column */}
            <th
              className="sticky left-0 border-b border-r px-2 py-2 text-left text-xs font-medium"
              style={{
                width: 36,
                minWidth: 36,
                borderColor: "var(--border-subtle)",
                color: "var(--text-muted)",
                backgroundColor: "var(--surface-1)",
              }}
            >
              #
            </th>
            {visibleIds.map((fid) => {
              const f = fieldById.get(fid);
              if (!f) return null;
              return (
                <th
                  key={fid}
                  className="border-b border-r px-2 py-2 text-left text-xs font-medium"
                  style={{
                    minWidth: columnMinWidth(f),
                    borderColor: "var(--border-subtle)",
                    color: "var(--text-secondary)",
                  }}
                >
                  <div className="flex items-center gap-1.5">
                    <FieldKindBadge kind={f.kind} />
                    <span>{f.label || f.name}</span>
                  </div>
                </th>
              );
            })}
            {/* Trailing actions column */}
            <th
              className="border-b px-1 py-2 text-xs"
              style={{
                width: 44,
                borderColor: "var(--border-subtle)",
                color: "var(--text-muted)",
              }}
            />
          </tr>
        </thead>

        <tbody>
          {isLoading && (
            <tr>
              <td
                colSpan={visibleIds.length + 2}
                className="px-3 py-8 text-center text-xs"
                style={{ color: "var(--text-muted)" }}
              >
                Chargement…
              </td>
            </tr>
          )}
          {isError && (
            <tr>
              <td
                colSpan={visibleIds.length + 2}
                className="px-3 py-8 text-center text-xs"
                style={{ color: "#EF4444" }}
              >
                Erreur de chargement
              </td>
            </tr>
          )}
          {!isLoading && !isError && items.length === 0 && (
            <tr>
              <td
                colSpan={visibleIds.length + 2}
                className="px-3 py-8 text-center text-xs"
                style={{ color: "var(--text-muted)" }}
              >
                Aucune entrée. Cliquez sur « + Nouvelle entrée » en bas.
              </td>
            </tr>
          )}
          {items.map((entity, idx) => (
            <tr
              key={entity.id}
              className="group"
              style={{ borderBottom: "1px solid var(--border-subtle)" }}
            >
              <td
                className="sticky left-0 border-r px-2 py-1 text-xs"
                style={{
                  borderColor: "var(--border-subtle)",
                  color: "var(--text-muted)",
                  backgroundColor: "var(--surface-0)",
                }}
              >
                {idx + 1}
              </td>
              {visibleIds.map((fid) => {
                const f = fieldById.get(fid);
                if (!f) return null;
                return (
                  <td
                    key={fid}
                    className="border-r p-0"
                    style={{
                      borderColor: "var(--border-subtle)",
                      verticalAlign: "top",
                    }}
                  >
                    <Cell
                      field={f}
                      value={entity.fields[fid]}
                      onChange={(next) => {
                        mut.update.mutate({
                          id: entity.id,
                          fields: { [fid]: next as never },
                        });
                      }}
                    />
                  </td>
                );
              })}
              <td className="px-1">
                <button
                  type="button"
                  className="invisible rounded p-1 hover:bg-[var(--surface-2)] group-hover:visible"
                  title="Supprimer la ligne"
                  onClick={() => {
                    if (confirm("Supprimer cette entrée ?")) {
                      mut.delete.mutate({ id: entity.id });
                    }
                  }}
                  style={{ color: "var(--text-muted)" }}
                >
                  <Trash size={14} />
                </button>
              </td>
            </tr>
          ))}

          {/* + Add row */}
          <tr>
            <td
              colSpan={visibleIds.length + 2}
              className="px-2 py-2"
              style={{ borderTop: "1px solid var(--border-subtle)" }}
            >
              <button
                type="button"
                onClick={addRow}
                className="flex items-center gap-1.5 rounded px-2 py-1 text-xs font-medium hover:bg-[var(--surface-2)]"
                style={{ color: "var(--text-secondary)" }}
              >
                <Plus size={12} /> Nouvelle entrée
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function columnMinWidth(field: Field): number {
  switch (field.kind) {
    case "bool":
      return 64;
    case "rating":
      return 100;
    case "number":
    case "currency":
    case "percent":
    case "duration":
      return 110;
    case "date":
    case "datetime":
      return 140;
    case "longtext":
    case "markdown":
      return 260;
    case "select":
    case "multiselect":
    case "status":
      return 140;
    default:
      return 160;
  }
}
