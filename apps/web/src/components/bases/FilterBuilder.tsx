"use client";

/**
 * FilterBuilder — popover that edits the FilterClause[] of a view.
 *
 * One row per clause. Each row: [Field ▾] [Op ▾] [Value]  [×]. A trailing
 * "+ Ajouter un filtre" creates a new row pre-populated with the first
 * field of the schema. Changes are committed immediately via
 * `useViewMutations().update` — the table refreshes through
 * `views.queryForView` invalidation.
 *
 * Closing the popover is the caller's concern; we just edit state.
 */

import { useEffect, useRef } from "react";
import { Funnel, X, Plus } from "@phosphor-icons/react";
import type { EntityType, Field, FilterClause, FilterOp, SelectOption } from "@supernote/core";
import type { View } from "@supernote/ipc";
import { useViewMutations } from "./hooks";
import { opsForFieldKind, defaultOpForFieldKind, labelForField } from "./filter-ops";

interface FilterBuilderProps {
  base: EntityType;
  view: View;
  onClose: () => void;
}

export function FilterBuilder({ base, view, onClose }: FilterBuilderProps) {
  const { update } = useViewMutations();
  const popoverRef = useRef<HTMLDivElement | null>(null);

  // Close on outside-click. We watch mousedown rather than click so the
  // close fires before any child <button> handler — otherwise an inner
  // dropdown menu's onClick can be lost because the popover re-renders.
  useEffect(() => {
    const onDocMouseDown = (e: MouseEvent) => {
      if (!popoverRef.current) return;
      if (popoverRef.current.contains(e.target as Node)) return;
      onClose();
    };
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, [onClose]);

  const commit = (filters: FilterClause[]) => {
    // Cast filters through unknown to avoid the IPC vs core type drift —
    // both sides have structurally-compatible shapes.
    update.mutate({ id: view.id, filters: filters as unknown as never });
  };

  const addClause = () => {
    const firstField = base.fields[0];
    if (!firstField) return;
    commit([
      ...view.filters,
      { fieldId: firstField.id, op: defaultOpForFieldKind(firstField.kind), value: "" },
    ]);
  };

  const removeClause = (index: number) => {
    commit(view.filters.filter((_, i) => i !== index));
  };

  const updateClause = (index: number, patch: Partial<FilterClause>) => {
    commit(
      view.filters.map((c, i) => (i === index ? { ...c, ...patch } : c)),
    );
  };

  const clauses = view.filters as FilterClause[];

  return (
    <div
      ref={popoverRef}
      className="absolute z-50 mt-1 rounded-lg border shadow-lg"
      style={{
        minWidth: 460,
        backgroundColor: "var(--surface-1)",
        borderColor: "var(--border-subtle)",
      }}
    >
      <div
        className="flex items-center gap-2 border-b px-3 py-2"
        style={{ borderColor: "var(--border-subtle)" }}
      >
        <Funnel size={13} style={{ color: "var(--text-muted)" }} />
        <span
          className="text-xs font-semibold uppercase tracking-wide"
          style={{ color: "var(--text-muted)" }}
        >
          Filtres
        </span>
        <span className="text-xs" style={{ color: "var(--text-muted)" }}>
          ({clauses.length})
        </span>
      </div>

      <div className="flex flex-col gap-1 px-3 py-2">
        {clauses.length === 0 && (
          <p
            className="py-2 text-center text-xs"
            style={{ color: "var(--text-muted)" }}
          >
            Aucun filtre. Toutes les entrées s'affichent.
          </p>
        )}
        {clauses.map((clause, index) => (
          <FilterRow
            key={`${index}:${clause.fieldId}`}
            base={base}
            clause={clause}
            onChange={(patch) => updateClause(index, patch)}
            onRemove={() => removeClause(index)}
          />
        ))}
      </div>

      <div
        className="border-t px-3 py-2"
        style={{ borderColor: "var(--border-subtle)" }}
      >
        <button
          type="button"
          onClick={addClause}
          className="flex items-center gap-1.5 rounded px-2 py-1 text-xs font-medium hover:bg-[var(--surface-2)]"
          style={{ color: "var(--text-secondary)" }}
        >
          <Plus size={11} /> Ajouter un filtre
        </button>
      </div>
    </div>
  );
}

// ── FilterRow ────────────────────────────────────────────────────────────

interface FilterRowProps {
  base: EntityType;
  clause: FilterClause;
  onChange: (patch: Partial<FilterClause>) => void;
  onRemove: () => void;
}

function FilterRow({ base, clause, onChange, onRemove }: FilterRowProps) {
  const field = base.fields.find((f) => f.id === clause.fieldId) ?? base.fields[0];
  if (!field) return null;
  const ops = opsForFieldKind(field.kind);
  const currentOp = ops.find((o) => o.op === clause.op) ?? ops[0];
  if (!currentOp) return null;

  return (
    <div className="flex items-center gap-1.5">
      {/* Field picker */}
      <select
        value={field.id}
        onChange={(e) => {
          const nextField = base.fields.find((f) => f.id === e.target.value);
          if (!nextField) return;
          // When the field changes, the operator must also be valid for the
          // new kind. Fall back to the kind's default operator.
          onChange({
            fieldId: nextField.id,
            op: defaultOpForFieldKind(nextField.kind),
            value: "",
          });
        }}
        className="rounded border bg-transparent px-1.5 py-1 text-xs"
        style={{
          borderColor: "var(--border-subtle)",
          color: "var(--text-primary)",
          minWidth: 130,
        }}
      >
        {base.fields.map((f) => (
          <option key={f.id} value={f.id}>
            {labelForField(f)}
          </option>
        ))}
      </select>

      {/* Op picker */}
      <select
        value={currentOp.op}
        onChange={(e) => onChange({ op: e.target.value as FilterOp })}
        className="rounded border bg-transparent px-1.5 py-1 text-xs"
        style={{
          borderColor: "var(--border-subtle)",
          color: "var(--text-primary)",
          minWidth: 110,
        }}
      >
        {ops.map((o) => (
          <option key={o.op} value={o.op}>
            {o.label}
          </option>
        ))}
      </select>

      {/* Value editor — kind-specific */}
      <div className="flex-1">
        {currentOp.needsValue ? (
          <FilterValueInput
            field={field}
            value={clause.value}
            onChange={(v) => onChange({ value: v })}
          />
        ) : (
          <span className="text-xs" style={{ color: "var(--text-muted)" }}>—</span>
        )}
      </div>

      <button
        type="button"
        onClick={onRemove}
        className="rounded p-1 hover:bg-[var(--surface-2)]"
        title="Supprimer le filtre"
        style={{ color: "var(--text-muted)" }}
      >
        <X size={12} />
      </button>
    </div>
  );
}

// ── Value input by kind ──────────────────────────────────────────────────

function FilterValueInput({
  field,
  value,
  onChange,
}: {
  field: Field;
  value: unknown;
  onChange: (next: unknown) => void;
}) {
  const baseStyle = {
    borderColor: "var(--border-subtle)",
    color: "var(--text-primary)",
  };
  const cls = "w-full rounded border bg-transparent px-1.5 py-1 text-xs";

  switch (field.kind) {
    case "number":
    case "currency":
    case "percent":
    case "rating":
    case "progress":
    case "duration":
    case "autoNumber":
      return (
        <input
          type="number"
          className={cls}
          style={baseStyle}
          value={value === null || value === undefined ? "" : String(value)}
          onChange={(e) => onChange(e.target.value === "" ? "" : Number(e.target.value))}
        />
      );
    case "date":
    case "datetime":
    case "createdAt":
    case "updatedAt":
      return (
        <input
          type={field.kind === "datetime" || field.kind === "createdAt" || field.kind === "updatedAt" ? "datetime-local" : "date"}
          className={cls}
          style={baseStyle}
          value={value === null || value === undefined ? "" : String(value).slice(0, field.kind === "date" ? 10 : 16)}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    case "bool":
      return (
        <select
          className={cls}
          style={baseStyle}
          value={value === true ? "true" : value === false ? "false" : ""}
          onChange={(e) =>
            onChange(e.target.value === "true" ? true : e.target.value === "false" ? false : null)
          }
        >
          <option value="">—</option>
          <option value="true">Vrai</option>
          <option value="false">Faux</option>
        </select>
      );
    case "select":
    case "status":
    case "multiselect": {
      const opts = (field as { options: SelectOption[] }).options ?? [];
      return (
        <select
          className={cls}
          style={baseStyle}
          value={value === null || value === undefined ? "" : String(value)}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">—</option>
          {opts.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      );
    }
    default:
      return (
        <input
          type="text"
          className={cls}
          style={baseStyle}
          value={value === null || value === undefined ? "" : String(value)}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Valeur…"
        />
      );
  }
}
