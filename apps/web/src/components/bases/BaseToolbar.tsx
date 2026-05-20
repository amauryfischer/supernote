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
import { Button } from "@heroui/react";
import {
  Funnel,
  ArrowsDownUp,
  Eye,
  Plus,
  Stack,
  CalendarBlank,
  PaintBrush,
} from "@phosphor-icons/react";
import type { EntityType } from "@supernote/core";
import type { View } from "@supernote/ipc";
import { FilterBuilder } from "./FilterBuilder";
import { SortBuilder } from "./SortBuilder";
import { PivotFieldMenu } from "./PivotFieldMenu";
import { ConditionalFormatBuilder } from "./ConditionalFormatBuilder";
import { useShellChrome } from "@/components/shell/shell-chrome-context";

type OpenMenu = "filters" | "sorts" | "pivot" | "cf" | null;

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
  const { openColumnEditor, columnEditor, closeColumnEditor } = useShellChrome();
  const filterCount = view.filters.length;
  const sortCount = view.sorts.length;
  const hiddenCount = view.hiddenFields.length;
  const cfCount = (view.conditionalFormats ?? []).length;
  const columnEditorOpen = columnEditor?.view.id === view.id;

  // Helper so each trigger toggles its own menu and closes the others.
  const toggle = (next: OpenMenu) =>
    setOpen((current) => (current === next ? null : next));

  const toggleColumnEditor = () => {
    if (columnEditorOpen) closeColumnEditor();
    else openColumnEditor(base, view);
  };

  // Kanban / List need a "Group by" pivot field; Calendar needs a "Date"
  // pivot field. Both reuse the view's `groupByField` slot — the active
  // renderer decides how to interpret it.
  const showGroupPivot = view.kind === "board" || view.kind === "list";
  const showDatePivot = view.kind === "calendar";

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
          active={columnEditorOpen}
          count={hiddenCount > 0 ? hiddenCount : undefined}
          countTone="muted"
          onClick={toggleColumnEditor}
        />
      </div>

      <div className="relative">
        <ToolbarButton
          icon={<PaintBrush size={11} />}
          label="Format"
          active={open === "cf"}
          count={cfCount > 0 ? cfCount : undefined}
          onClick={() => toggle("cf")}
        />
        {open === "cf" && (
          <ConditionalFormatBuilder
            base={base}
            view={view}
            onClose={() => setOpen(null)}
          />
        )}
      </div>

      {(showGroupPivot || showDatePivot) && (
        <div className="relative">
          <ToolbarButton
            icon={showDatePivot ? <CalendarBlank size={11} /> : <Stack size={11} />}
            label={showDatePivot ? "Date" : "Grouper"}
            active={open === "pivot"}
            count={view.groupByField ? 1 : undefined}
            countTone="accent"
            onClick={() => toggle("pivot")}
          />
          {open === "pivot" && (
            <PivotFieldMenu
              base={base}
              view={view}
              mode={showDatePivot ? "date" : "group"}
              onClose={() => setOpen(null)}
            />
          )}
        </div>
      )}

      <div className="ml-auto flex items-center gap-1">
        {extra}
        {onCreateEntry && (
          <Button
            size="sm"
            variant="primary"
            onPress={onCreateEntry}
            className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium"
            style={{ backgroundColor: "var(--accent)", color: "var(--accent-foreground)" }}
          >
            <Plus size={11} /> Nouvelle entrée
          </Button>
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
    <Button
      variant="ghost"
      size="sm"
      onPress={onClick}
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
    </Button>
  );
}
