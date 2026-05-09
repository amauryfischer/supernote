"use client";

/**
 * TodoRow — a single line in the /todos panel and the right-sidebar widget.
 *
 * Visual hierarchy (left → right):
 *   [importance pastille] [priority badge "P{n}"] [checkbox] [text]
 *   then on the right: [📝 source link] [📧 email] [due date]
 *
 * Critical importance bumps the row's left border to red and slightly
 * upsizes the text so it draws attention even when the page is scanned at
 * low information density.
 */

import * as React from "react";
import Link from "next/link";
import { FileText, Envelope } from "@phosphor-icons/react";

export type TodoImportance = "low" | "medium" | "high" | "critical";

export interface TodoRowData {
  id: string;
  text: string;
  done: boolean;
  sourceNoteId: string | null;
  /** 0-based source line; used to build the deep link to the note. */
  line: number | null;
  blockId: string | null;
  dueDate: string | null;
  priority: number | null;
  importance: TodoImportance | null;
  sourceNoteTitle?: string | null;
}

interface TodoRowProps {
  row: TodoRowData;
  onToggle: () => void;
  onEdit?: () => void;
  onEmail?: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
}

const IMPORTANCE_COLOR: Record<TodoImportance, string> = {
  low: "#22C55E", // green
  medium: "#FBBF24", // yellow
  high: "#F97316", // orange
  critical: "#EF4444", // red
};

const IMPORTANCE_LABEL: Record<TodoImportance, string> = {
  low: "Basse",
  medium: "Moyenne",
  high: "Haute",
  critical: "Critique",
};

export function importanceColor(level: TodoImportance | null): string {
  return level ? IMPORTANCE_COLOR[level] : IMPORTANCE_COLOR.medium;
}

export function importanceLabel(level: TodoImportance | null): string {
  return level ? IMPORTANCE_LABEL[level] : IMPORTANCE_LABEL.medium;
}

export function TodoRow({ row, onToggle, onEdit, onEmail, onContextMenu }: TodoRowProps) {
  const isCritical = row.importance === "critical";
  const dotColor = importanceColor(row.importance);
  const priority = row.priority ?? 5;

  return (
    <li
      onContextMenu={onContextMenu}
      className="group relative flex items-start gap-2 rounded-md px-2 py-1.5 transition-colors hover:bg-[var(--surface-2)]"
      style={{
        borderLeft: isCritical ? "3px solid #EF4444" : "3px solid transparent",
        paddingLeft: isCritical ? "0.5rem" : "0.5rem",
      }}
    >
      {/* Importance pastille */}
      <span
        className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
        style={{ backgroundColor: dotColor }}
        title={`Importance : ${importanceLabel(row.importance)}`}
      />

      {/* Priority badge */}
      <span
        className="mt-0.5 inline-flex h-4 min-w-[1.5rem] shrink-0 items-center justify-center rounded px-1 text-[10px] font-bold tabular-nums"
        style={{
          backgroundColor: "var(--surface-3)",
          color: "var(--text-muted)",
        }}
        title={`Priorité ${priority}`}
      >
        P{priority}
      </span>

      {/* Checkbox */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onToggle();
        }}
        aria-label={row.done ? "Marquer comme non faite" : "Marquer comme faite"}
        className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border"
        style={{
          borderColor: row.done ? "var(--accent)" : "var(--border)",
          backgroundColor: row.done ? "var(--accent)" : "transparent",
        }}
      >
        {row.done && (
          <svg width="10" height="10" viewBox="0 0 16 16" fill="none">
            <path
              d="M3 8.5L6.5 12L13 4.5"
              stroke="white"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}
      </button>

      {/* Main text — clickable to open the edit modal. */}
      <button
        type="button"
        onClick={onEdit}
        className="flex-1 min-w-0 text-left leading-tight hover:underline"
        style={{
          color: row.done ? "var(--text-muted)" : "var(--text-primary)",
          textDecoration: row.done ? "line-through" : undefined,
          fontSize: isCritical ? "0.95rem" : "0.875rem",
          fontWeight: isCritical ? 600 : 400,
        }}
      >
        {row.text}
      </button>

      {/* Source note link */}
      {row.sourceNoteId && (
        <Link
          href={
            row.line !== null
              ? `/notes/${row.sourceNoteId}#L${row.line + 1}`
              : `/notes/${row.sourceNoteId}`
          }
          prefetch={false}
          onClick={(e) => e.stopPropagation()}
          className="flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[10px] opacity-0 transition-opacity group-hover:opacity-100"
          style={{ color: "var(--text-muted)" }}
          title={row.sourceNoteTitle ? `Voir « ${row.sourceNoteTitle} »` : "Voir la note"}
        >
          <FileText size={11} />
          Note
        </Link>
      )}

      {/* Email button */}
      {onEmail && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onEmail();
          }}
          aria-label="Envoyer par email"
          className="flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[10px] opacity-0 transition-opacity group-hover:opacity-100"
          style={{ color: "var(--text-muted)" }}
          title="Envoyer cette tâche par email"
        >
          <Envelope size={11} />
        </button>
      )}

      {/* Due date */}
      {row.dueDate && (
        <span
          className="mt-0.5 shrink-0 text-[10px] tabular-nums"
          style={{ color: "var(--text-muted)" }}
          title={`Échéance : ${row.dueDate}`}
        >
          {new Date(row.dueDate).toLocaleDateString("fr-FR", {
            day: "2-digit",
            month: "short",
          })}
        </span>
      )}
    </li>
  );
}
