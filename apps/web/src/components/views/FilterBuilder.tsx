"use client";

import { Plus, Trash } from "@phosphor-icons/react";
import type { FilterClause, FilterOperator } from "@supernote/views";
import type { EntityType, Field } from "@supernote/core";

const OPERATORS: { value: FilterOperator; label: string }[] = [
  { value: "eq", label: "=" },
  { value: "neq", label: "!=" },
  { value: "contains", label: "contient" },
  { value: "startsWith", label: "commence par" },
  { value: "endsWith", label: "finit par" },
  { value: "lt", label: "<" },
  { value: "lte", label: "<=" },
  { value: "gt", label: ">" },
  { value: "gte", label: ">=" },
  { value: "isEmpty", label: "vide" },
  { value: "isNotEmpty", label: "non vide" },
];

interface FilterBuilderProps {
  filters: FilterClause[];
  schema: EntityType;
  onChange: (filters: FilterClause[]) => void;
}

export function FilterBuilder({ filters, schema, onChange }: FilterBuilderProps) {
  const addFilter = () => {
    const firstField = schema.fields[0];
    if (!firstField) return;
    onChange([...filters, { fieldId: firstField.id, operator: "eq", value: "" }]);
  };

  const removeFilter = (index: number) => {
    onChange(filters.filter((_, i) => i !== index));
  };

  const updateFilter = (index: number, patch: Partial<FilterClause>) => {
    onChange(filters.map((f, i) => (i === index ? { ...f, ...patch } : f)));
  };

  return (
    <div className="flex flex-col gap-2">
      {filters.map((filter, i) => (
        <div key={i} className="flex items-center gap-2">
          <select
            className="rounded-md border px-2 py-1 text-sm"
            style={{
              borderColor: "var(--border-subtle)",
              backgroundColor: "var(--surface-1)",
              color: "var(--text-primary)",
            }}
            value={filter.fieldId}
            onChange={(e) => updateFilter(i, { fieldId: e.target.value })}
          >
            {schema.fields.map((f: Field) => (
              <option key={f.id} value={f.id}>{f.label}</option>
            ))}
          </select>

          <select
            className="rounded-md border px-2 py-1 text-sm"
            style={{
              borderColor: "var(--border-subtle)",
              backgroundColor: "var(--surface-1)",
              color: "var(--text-primary)",
            }}
            value={filter.operator}
            onChange={(e) => updateFilter(i, { operator: e.target.value as FilterOperator })}
          >
            {OPERATORS.map((op) => (
              <option key={op.value} value={op.value}>{op.label}</option>
            ))}
          </select>

          {filter.operator !== "isEmpty" && filter.operator !== "isNotEmpty" && (
            <input
              className="flex-1 rounded-md border px-2 py-1 text-sm"
              style={{
                borderColor: "var(--border-subtle)",
                backgroundColor: "var(--surface-1)",
                color: "var(--text-primary)",
              }}
              value={String(filter.value ?? "")}
              placeholder="valeur..."
              onChange={(e) => updateFilter(i, { value: e.target.value })}
            />
          )}

          <button
            onClick={() => removeFilter(i)}
            className="flex h-7 w-7 items-center justify-center rounded text-sm transition-colors hover:bg-red-50"
            style={{ color: "var(--text-muted)" }}
            aria-label="Supprimer filtre"
          >
            <Trash size={14} />
          </button>
        </div>
      ))}

      <button
        onClick={addFilter}
        className="flex items-center gap-1 self-start rounded-md px-3 py-1.5 text-xs font-medium transition-colors hover:opacity-80"
        style={{
          backgroundColor: "var(--accent-subtle)",
          color: "var(--accent)",
        }}
      >
        <Plus size={12} weight="bold" />
        Ajouter un filtre
      </button>
    </div>
  );
}
