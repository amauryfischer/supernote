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

import { useEffect, useRef, useState } from "react";
import { Button, Input } from "@heroui/react";
import {
  Funnel,
  ArrowsDownUp,
  Eye,
  Plus,
  Stack,
  CalendarBlank,
  PaintBrush,
  MagnifyingGlass,
  X,
} from "@phosphor-icons/react";
import { Tooltip } from "@supernote/ui";
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
  /** Recherche instantanée — valeur contrôlée par le parent (BaseView). */
  searchQuery?: string;
  /** Callback de la recherche instantanée. L'input n'apparaît que si fourni. */
  onSearchQueryChange?: (query: string) => void;
}

export function BaseToolbar({
  base,
  view,
  onCreateEntry,
  extra,
  searchQuery,
  onSearchQueryChange,
}: BaseToolbarProps) {
  const [open, setOpen] = useState<OpenMenu>(null);
  const query = searchQuery ?? "";
  const showSearch = typeof onSearchQueryChange === "function";
  // Ref sur le conteneur (pas sur <Input>) : on retrouve l'input natif via
  // querySelector, indépendamment du forwarding de ref du composant HeroUI.
  const searchWrapRef = useRef<HTMLDivElement | null>(null);
  const focusSearch = () => {
    searchWrapRef.current?.querySelector("input")?.focus();
  };

  // Raccourci « / » : focus la recherche (comportement Notion/Linear) — sauf
  // si la frappe a déjà lieu dans un input/textarea/contenteditable.
  useEffect(() => {
    if (!showSearch) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) {
        return;
      }
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.tagName === "INPUT" ||
          t.tagName === "TEXTAREA" ||
          t.isContentEditable ||
          t.closest("input, textarea, [contenteditable]"))
      ) {
        return;
      }
      e.preventDefault();
      focusSearch();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [showSearch]);
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
  const showGroupPivot =
    view.kind === "board" || view.kind === "list" || view.kind === "table";
  const showDatePivot = view.kind === "calendar";

  return (
    <div
      className="flex flex-wrap items-center gap-1.5 border-b px-4 py-2"
      style={{
        borderColor: "var(--border-subtle)",
        backgroundColor: "var(--surface-0)",
      }}
    >
      <div className="relative">
        <ToolbarButton
          icon={<Funnel size={13} />}
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
          icon={<ArrowsDownUp size={13} />}
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
          icon={<Eye size={13} />}
          label="Colonnes"
          active={columnEditorOpen}
          count={hiddenCount > 0 ? hiddenCount : undefined}
          countTone="muted"
          onClick={toggleColumnEditor}
        />
      </div>

      <div className="relative">
        <ToolbarButton
          icon={<PaintBrush size={13} />}
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
            icon={showDatePivot ? <CalendarBlank size={13} /> : <Stack size={13} />}
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

      <div className="ml-auto flex min-w-0 flex-1 items-center justify-end gap-1.5">
        {showSearch && (
          <div
            ref={searchWrapRef}
            className="flex min-w-[120px] flex-1 items-center gap-1.5 rounded-md border border-[var(--border-subtle)] bg-[var(--surface-1)] px-2 py-1 focus-within:border-[var(--accent)] md:w-52 md:flex-none"
            style={{ transition: "var(--sn-transition-colors)" }}
          >
            <MagnifyingGlass
              size={13}
              style={{ color: "var(--text-muted)" }}
              aria-hidden
            />
            <Input
              type="text"
              value={query}
              onChange={(e) => onSearchQueryChange?.(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.preventDefault();
                  e.stopPropagation();
                  onSearchQueryChange?.("");
                  e.currentTarget.blur();
                }
              }}
              placeholder="Rechercher…"
              aria-label="Rechercher dans la base"
              className="w-full min-w-0 bg-transparent text-sm outline-none"
              style={{ color: "var(--text-primary)" }}
            />
            {query ? (
              <Tooltip content="Effacer la recherche">
                <Button
                  isIconOnly
                  variant="ghost"
                  size="sm"
                  onPress={() => {
                    onSearchQueryChange?.("");
                    focusSearch();
                  }}
                  aria-label="Effacer la recherche"
                  className="h-5 w-5 min-w-0 shrink-0 p-0"
                >
                  <X size={12} style={{ color: "var(--text-muted)" }} />
                </Button>
              </Tooltip>
            ) : (
              <kbd
                className="hidden rounded border px-1 text-[10px] md:inline"
                style={{
                  borderColor: "var(--border-subtle)",
                  color: "var(--text-muted)",
                }}
                aria-hidden
              >
                /
              </kbd>
            )}
          </div>
        )}
        {extra}
        {onCreateEntry && (
          <Button
            size="sm"
            variant="primary"
            onPress={onCreateEntry}
            className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium"
            style={{ backgroundColor: "var(--btn-primary-bg)", color: "var(--btn-primary-fg)" }}
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
      className="flex items-center gap-2 rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors"
      style={{
        backgroundColor: active ? "var(--surface-2)" : "transparent",
        color: hasCount && countTone === "accent" ? "var(--accent)" : "var(--text-secondary)",
      }}
    >
      {icon}
      {label}
      {hasCount && (
        <span
          className="rounded-full px-1.5 text-[11px]"
          style={{
            backgroundColor:
              countTone === "accent" ? "var(--btn-primary-bg)" : "var(--surface-3)",
            color:
              countTone === "accent" ? "var(--btn-primary-fg)" : "var(--text-muted)",
          }}
        >
          {count}
        </span>
      )}
    </Button>
  );
}
