"use client";

/**
 * TodoBulkActionBar — floating action bar shown when one or more todos are
 * selected in the /todos list. Mirrors the visual language of the Contacts
 * `BulkActionBar` (centered pill, blurred surface) but exposes the todo-specific
 * bulk actions: mark complete / reopen, and delete.
 *
 * Mobile parity: the bar is fixed near the bottom, full-width-safe (clamps to
 * the viewport via `max-w` + horizontal margins) and uses comfortable tap
 * targets. Action labels collapse to icons on the narrowest screens.
 */

import { Button } from "@heroui/react";
import { CheckCircle, ArrowCounterClockwise, Trash, X } from "@phosphor-icons/react";

interface TodoBulkActionBarProps {
  selectedCount: number;
  /** When true, all selected todos are already done → the primary action
   *  becomes "reopen" instead of "complete". */
  allDone: boolean;
  /** How many of the selected todos are deletable (standalone). When 0 the
   *  delete button is hidden, since note-derived todos cannot be deleted here. */
  deletableCount: number;
  onClear: () => void;
  onComplete: () => void;
  onReopen: () => void;
  onDelete: () => void;
}

export function TodoBulkActionBar({
  selectedCount,
  allDone,
  deletableCount,
  onClear,
  onComplete,
  onReopen,
  onDelete,
}: TodoBulkActionBarProps) {
  if (selectedCount === 0) return null;

  return (
    <div
      className="fixed bottom-[calc(56px+16px+env(safe-area-inset-bottom,0px))] left-1/2 z-50 flex max-w-[calc(100vw-1.5rem)] -translate-x-1/2 items-center gap-2 rounded-xl border px-3 py-2.5 shadow-xl sm:gap-3 sm:px-4 sm:py-3 md:bottom-6"
      style={{
        // Mobile shell shows a 56px bottom nav — the `bottom-[…]` class lifts
        // the bar clear of it; `md:bottom-6` resets the offset on desktop where
        // there is no bottom nav.
        backgroundColor: "var(--surface-1)",
        borderColor: "var(--border)",
        backdropFilter: "blur(8px)",
      }}
      role="toolbar"
      aria-label="Actions groupées"
    >
      <span
        className="shrink-0 text-sm font-medium tabular-nums"
        style={{ color: "var(--text-primary)" }}
      >
        {selectedCount} <span className="hidden sm:inline">sélectionnée{selectedCount > 1 ? "s" : ""}</span>
      </span>

      <div className="flex items-center gap-1.5 sm:gap-2">
        {allDone ? (
          <Button
            variant="ghost"
            size="sm"
            onPress={onReopen}
            className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium sm:px-3"
            style={{ color: "var(--text-secondary)" }}
          >
            <ArrowCounterClockwise size={14} />
            <span className="hidden sm:inline">Rouvrir</span>
          </Button>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            onPress={onComplete}
            className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium sm:px-3"
            style={{ color: "var(--text-secondary)" }}
          >
            <CheckCircle size={14} />
            <span className="hidden sm:inline">Compléter</span>
          </Button>
        )}

        {deletableCount > 0 && (
          <Button
            variant="ghost"
            size="sm"
            onPress={onDelete}
            className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium sm:px-3"
            style={{ color: "var(--danger, #EF4444)" }}
          >
            <Trash size={14} />
            <span className="hidden sm:inline">
              Supprimer{deletableCount < selectedCount ? ` (${deletableCount})` : ""}
            </span>
          </Button>
        )}
      </div>

      <Button
        isIconOnly
        variant="ghost"
        size="sm"
        onPress={onClear}
        className="h-8 w-8 shrink-0 rounded-md"
        style={{ color: "var(--text-muted)" }}
        aria-label="Désélectionner tout"
      >
        <X size={15} />
      </Button>
    </div>
  );
}
