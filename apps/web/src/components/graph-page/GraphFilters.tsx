"use client";

import { X } from "@phosphor-icons/react";
import {
  ALL_NODE_TYPES,
  NODE_TYPE_COLORS,
  NODE_TYPE_LABELS,
  type NodeType,
} from "./fixtures";

interface GraphFiltersProps {
  activeTypes: NodeType[];
  onToggleType: (type: NodeType) => void;
  onClearTypes: () => void;
  tagFilter: string;
  onTagFilterChange: (tag: string) => void;
}

export function GraphFilters({
  activeTypes,
  onToggleType,
  onClearTypes,
  tagFilter,
  onTagFilterChange,
}: GraphFiltersProps) {
  return (
    <div
      className="flex flex-wrap items-center gap-2 border-b px-4 py-2"
      style={{
        borderColor: "var(--border-subtle)",
        backgroundColor: "var(--surface-1)",
        zIndex: 10,
      }}
    >
      <span className="text-xs font-medium" style={{ color: "var(--text-muted)" }}>
        Filtres :
      </span>

      {/* Type toggles */}
      <div className="flex flex-wrap gap-1.5">
        {ALL_NODE_TYPES.map((type) => {
          const active =
            activeTypes.length === 0 || activeTypes.includes(type);
          return (
            <button
              key={type}
              onClick={() => onToggleType(type)}
              className="flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium transition-all"
              style={{
                borderColor: NODE_TYPE_COLORS[type],
                backgroundColor: active
                  ? `${NODE_TYPE_COLORS[type]}22`
                  : "transparent",
                color: active ? NODE_TYPE_COLORS[type] : "var(--text-muted)",
                opacity: active ? 1 : 0.5,
              }}
            >
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{ backgroundColor: NODE_TYPE_COLORS[type] }}
              />
              {NODE_TYPE_LABELS[type]}
            </button>
          );
        })}
      </div>

      {activeTypes.length > 0 && (
        <button
          onClick={onClearTypes}
          className="flex items-center gap-1 rounded-full px-2 py-0.5 text-xs transition-colors hover:bg-[var(--surface-2)]"
          style={{ color: "var(--text-muted)" }}
        >
          <X size={10} />
          Tout
        </button>
      )}

      {/* Tag filter */}
      <input
        type="text"
        value={tagFilter}
        onChange={(e) => onTagFilterChange(e.target.value)}
        placeholder="#tag…"
        className="ml-2 rounded-md border bg-transparent px-2 py-0.5 text-xs outline-none"
        style={{
          borderColor: "var(--border-subtle)",
          color: "var(--text-primary)",
          width: 100,
        }}
      />
    </div>
  );
}
