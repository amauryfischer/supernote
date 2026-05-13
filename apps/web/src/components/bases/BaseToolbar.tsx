"use client";

/**
 * BaseToolbar — single horizontal bar above the DataGrid with Filter / Sort /
 * Hide buttons that each open their popover, plus an optional trailing
 * "+ Nouvelle entrée" affordance for embeds.
 *
 * Layout intentionally compact: each button shows a count badge when the
 * view has clauses on that axis so the user immediately sees which axes
 * are active.
 */

import { useState } from "react";
import { Funnel, ArrowsDownUp, Eye, Plus } from "@phosphor-icons/react";
import type { EntityType } from "@supernote/core";
import type { View } from "@supernote/ipc";
import { FilterBuilder } from "./FilterBuilder";
import { SortBuilder } from "./SortBuilder";
import { VisibleFieldsMenu } from "./VisibleFieldsMenu";

type OpenMenu = "filters" | "sorts" | "fields" | null;

interface BaseToolbarProps {
  base: EntityType;
  view: View;
  /** When provided, renders a trailing "+ Nouvelle entrée" button. */
  onCreateEntry?: () => void;
  /** Optional extra controls (e.g. "Convertir en vue nommée" for inline blocks). */
  extra?: React.ReactNode;
}

export function BaseToolbar({ base, view, onCreateEntry, extra }: BaseToolbarProps) {
  const [open, setOpen] = useState<OpenMenu>(null);
  const filterCount = view.filters.length;
  const sortCount = view.sorts.length;
  const hiddenCount = view.hiddenFields.length;

  // Helper so each trigger toggles its own menu and closes the others.
  const toggle = (next: OpenMenu) =>
    setOpen((current) => (current === next ? null : next));

  return (
    <div
      className="flex items-center gap-1 border-b px-3 py-1.5"
      style={{
        borderColor: "var(--border-subtle)",
        backgroundColor: "var(--surface-0)",
      }}
    >
      <div className="relative">
        <ToolbarButton
          icon={<Funnel size={11} />}
          label="Filtrer"
          active={open === "filters"}
          count={filterCount}
          onClick={() => toggle("filters")}
        />
        {open === "filters" && (
          <FilterBuilder base={base} view={view} onClose={() => setOpen(null)} />
        )}
      </div>

      <div className="relative">
        <ToolbarButton
          icon={<ArrowsDownUp size={11} />}
          label="Trier"
          active={open === "sorts"}
          count={sortCount}
          onClick={() => toggle("sorts")}
        />
        {open === "sorts" && (
          <SortBuilder base={base} view={view} onClose={() => setOpen(null)} />
        )}
      </div>

      <div className="relative">
        <ToolbarButton
          icon={<Eye size={11} />}
          label="Colonnes"
          active={open === "fields"}
          count={hiddenCount > 0 ? hiddenCount : undefined}
          countTone="muted"
          onClick={() => toggle("fields")}
        />
        {open === "fields" && (
          <VisibleFieldsMenu base={base} view={view} onClose={() => setOpen(null)} />
        )}
      </div>

      <div className="ml-auto flex items-center gap-1">
        {extra}
        {onCreateEntry && (
          <button
            type="button"
            onClick={onCreateEntry}
            className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium"
            style={{ backgroundColor: "var(--accent)", color: "var(--accent-foreground)" }}
          >
            <Plus size={11} /> Nouvelle entrée
          </button>
        )}
      </div>
    </div>
  );
}

// ── ToolbarButton ────────────────────────────────────────────────────────

interface ToolbarButtonProps {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  count?: number;
  /** "accent" = badge picks up the accent color (active filter); "muted" = neutral. */
  countTone?: "accent" | "muted";
  onClick: () => void;
}

function ToolbarButton({
  icon,
  label,
  active,
  count,
  countTone = "accent",
  onClick,
}: ToolbarButtonProps) {
  const hasCount = typeof count === "number" && count > 0;
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium transition-colors"
      style={{
        backgroundColor: active ? "var(--surface-3)" : "transparent",
        color: hasCount && countTone === "accent" ? "var(--accent)" : "var(--text-secondary)",
      }}
    >
      {icon}
      {label}
      {hasCount && (
        <span
          className="rounded-full px-1.5 text-[10px]"
          style={{
            backgroundColor:
              countTone === "accent" ? "var(--accent)" : "var(--surface-3)",
            color:
              countTone === "accent" ? "var(--accent-foreground)" : "var(--text-muted)",
          }}
        >
          {count}
        </span>
      )}
    </button>
  );
}
