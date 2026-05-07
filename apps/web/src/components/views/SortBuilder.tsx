"use client";

import { Plus, Trash, ArrowUp, ArrowDown } from "@phosphor-icons/react";
import type { SortClause, SortDirection } from "@supernote/views";
import type { EntityType, Field } from "@supernote/core";

interface SortBuilderProps {
  sort: SortClause[];
  schema: EntityType;
  onChange: (sort: SortClause[]) => void;
}

export function SortBuilder({ sort, schema, onChange }: SortBuilderProps) {
  const addSort = () => {
    const firstField = schema.fields[0];
    if (!firstField) return;
    onChange([...sort, { fieldId: firstField.id, direction: "asc" }]);
  };

  const removeSort = (index: number) => {
    onChange(sort.filter((_, i) => i !== index));
  };

  const updateSort = (index: number, patch: Partial<SortClause>) => {
    onChange(sort.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  };

  return (
    <div className="flex flex-col gap-2">
      {sort.map((clause, i) => (
        <div key={i} className="flex items-center gap-2">
          <select
            className="flex-1 rounded-md border px-2 py-1 text-sm"
            style={{
              borderColor: "var(--border-subtle)",
              backgroundColor: "var(--surface-1)",
              color: "var(--text-primary)",
            }}
            value={clause.fieldId}
            onChange={(e) => updateSort(i, { fieldId: e.target.value })}
          >
            {schema.fields.map((f: Field) => (
              <option key={f.id} value={f.id}>{f.label}</option>
            ))}
          </select>

          <button
            onClick={() =>
              updateSort(i, { direction: clause.direction === "asc" ? "desc" : "asc" })
            }
            className="flex items-center gap-1 rounded-md border px-2 py-1 text-xs transition-colors hover:opacity-80"
            style={{
              borderColor: "var(--border-subtle)",
              backgroundColor: "var(--surface-1)",
              color: "var(--text-secondary)",
            }}
            aria-label="Changer direction"
          >
            {clause.direction === "asc" ? <ArrowUp size={12} /> : <ArrowDown size={12} />}
            {clause.direction === "asc" ? "Croissant" : "Decroissant"}
          </button>

          <button
            onClick={() => removeSort(i)}
            className="flex h-7 w-7 items-center justify-center rounded transition-colors hover:bg-red-50"
            style={{ color: "var(--text-muted)" }}
            aria-label="Supprimer tri"
          >
            <Trash size={14} />
          </button>
        </div>
      ))}

      <button
        onClick={addSort}
        className="flex items-center gap-1 self-start rounded-md px-3 py-1.5 text-xs font-medium transition-colors hover:opacity-80"
        style={{
          backgroundColor: "var(--accent-subtle)",
          color: "var(--accent)",
        }}
      >
        <Plus size={12} weight="bold" />
        Ajouter un tri
      </button>
    </div>
  );
}
