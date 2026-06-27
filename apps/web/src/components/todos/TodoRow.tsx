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
import { Button, Checkbox } from "@heroui/react";
import { FileText, Envelope, Bell } from "@phosphor-icons/react";
import { useDateFormat } from "@/lib/dateFormat";
import { InlineMarkdown } from "@/lib/inlineMarkdown";
import { useLongPress } from "@/hooks/useLongPress";

export type TodoImportance = "low" | "medium" | "high" | "critical";

export interface TodoRowData {
  id: string;
  text: string;
  done: boolean;
  sourceNoteId: string | null;
  /** 0-based source line; used to build the deep link to the note. */
  line: number | null;
  blockId: string | null;
  startDate: string | null;
  dueDate: string | null;
  priority: number | null;
  importance: TodoImportance | null;
  /** Eisenhower urgency axis. true = urgent. null/false = not urgent. */
  urgent?: boolean | null;
  sourceNoteTitle?: string | null;
  /** ISO datetime-local string (YYYY-MM-DDTHH:MM) or null. */
  reminderAt?: string | null;
  /** Custom reminder body (null = use default "Rappel : <text>"). */
  reminderText?: string | null;
  /** ISO datetime stamped by the engine when the one-shot fired. */
  reminderFiredAt?: string | null;
  /** Thread Gmail source (tâche créée depuis un email) → lien « ouvrir l'email ». */
  sourceThreadId?: string | null;
  /** Nom/email de l'expéditeur de l'email source (clarté). */
  sourceFromName?: string | null;
  /** Aperçu compact de l'email source (résumé IA si dispo, sinon snippet) →
   *  vue « quelques lignes » sous la tâche. */
  sourceSummary?: string | null;
}

interface TodoRowProps {
  row: TodoRowData;
  onToggle: () => void;
  onEdit?: () => void;
  onEmail?: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  /** Wrap the text on several lines (matrix cards) instead of the
   *  single-line truncate used by the full-width list view. */
  multiline?: boolean;
  /** When true, a selection checkbox is shown at the row's leading edge and
   *  the whole row toggles selection on click instead of opening the editor. */
  selectionMode?: boolean;
  /** Whether this row is currently part of the bulk selection. */
  selected?: boolean;
  /** Toggle this row's membership in the bulk selection. */
  onToggleSelect?: () => void;
  /** Fired on a touch long-press — used to enter selection mode on mobile. */
  onLongPress?: () => void;
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

/** Eisenhower importance axis — collapse the 4-level scale to a binary.
 *  high/critical = important, low/medium = not important. */
export function isImportant(level: TodoImportance | null | undefined): boolean {
  return level === "high" || level === "critical";
}

/** Pick the importance level to write when a todo is dragged across the
 *  importance axis in the matrix. We preserve granularity within each half
 *  (critical stays critical, low stays low) and only bump across the border:
 *    → important : low/medium become "high"
 *    → not important : high/critical become "medium" */
export function importanceForAxis(
  current: TodoImportance | null | undefined,
  important: boolean,
): TodoImportance {
  if (important) return isImportant(current) ? (current as TodoImportance) : "high";
  return isImportant(current) ? "medium" : (current ?? "medium");
}

export function TodoRow({
  row,
  onToggle,
  onEdit,
  onEmail,
  onContextMenu,
  multiline,
  selectionMode = false,
  selected = false,
  onToggleSelect,
  onLongPress,
}: TodoRowProps) {
  const isCritical = row.importance === "critical";
  const dotColor = importanceColor(row.importance);
  const priority = row.priority ?? 5;
  const { compact: formatCompactDate, full: formatFullDate } = useDateFormat();
  const longPress = useLongPress(onLongPress);

  // In selection mode, a tap on the row's non-interactive surface (the
  // importance pastille / priority badge / empty gaps) toggles its membership.
  // Clicks that land on the checkbox, the text button, links, or the done
  // toggle are handled by those controls directly — guard against them here so
  // the selection never flips twice for a single tap.
  const handleRowClick = (e: React.MouseEvent) => {
    if (!selectionMode) return;
    const target = e.target as HTMLElement;
    if (target.closest("a, button, input, [role='checkbox'], label")) return;
    onToggleSelect?.();
  };

  return (
    <li
      onContextMenu={onContextMenu}
      onClick={handleRowClick}
      {...longPress}
      className="group relative flex items-start gap-2 rounded-md px-2 py-1.5 transition-colors hover:bg-[var(--surface-2)]"
      style={{
        borderLeft: isCritical
          ? "3px solid #EF4444"
          : selected
            ? "3px solid var(--accent)"
            : "3px solid transparent",
        paddingLeft: isCritical ? "0.5rem" : "0.5rem",
        backgroundColor: selected ? "var(--accent-subtle)" : undefined,
        cursor: selectionMode ? "pointer" : undefined,
      }}
    >
      {/* Selection checkbox — only in selection mode */}
      {selectionMode && (
        <span
          className="mt-0.5 flex shrink-0 items-center"
          onClick={(e) => e.stopPropagation()}
        >
          <Checkbox
            isSelected={selected}
            onChange={() => onToggleSelect?.()}
            aria-label={selected ? "Désélectionner la tâche" : "Sélectionner la tâche"}
          />
        </span>
      )}

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

      {/* Urgent flag (Eisenhower urgency axis) */}
      {row.urgent && (
        <span
          className="mt-0.5 shrink-0 text-[11px] leading-4"
          title="Urgent"
          aria-label="Urgent"
        >
          🔥
        </span>
      )}

      {/* Checkbox */}
      <Button
        variant="ghost"
        onPress={(e) => {
          void e;
          onToggle();
        }}
        aria-label={row.done ? "Marquer comme non faite" : "Marquer comme faite"}
        className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border p-0 min-w-0"
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
      </Button>

      {/* Main text — clickable to open the edit modal. The Button is a flex
          container, so `text-overflow: ellipsis` must live on an inner block
          element (flex children clip without the "…" otherwise). The wrapping
          column also hosts the optional email-source preview line below. */}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <Button
          variant="ghost"
          onPress={selectionMode ? onToggleSelect : onEdit}
          className="w-full min-w-0 text-left leading-tight hover:underline p-0 h-auto justify-start"
          style={{
            color: row.done ? "var(--text-muted)" : "var(--text-primary)",
            textDecoration: row.done ? "line-through" : undefined,
            fontSize: isCritical ? "0.95rem" : "0.875rem",
            fontWeight: isCritical ? 600 : 400,
          }}
        >
          <span
            title={row.text}
            className={
              multiline
                ? "line-clamp-3 min-w-0 whitespace-normal [overflow-wrap:anywhere]"
                : "block min-w-0 truncate"
            }
          >
            <InlineMarkdown text={row.text} />
          </span>
        </Button>
        {/* Aperçu compact de l'email source (résumé IA / snippet) — seulement
            pour les tâches issues d'un email, masqué quand la tâche est faite. */}
        {row.sourceThreadId && row.sourceSummary && !row.done && (
          <p
            className="line-clamp-2 min-w-0 break-words text-[11px] leading-snug"
            style={{ color: "var(--text-muted)" }}
            title={row.sourceSummary}
          >
            {row.sourceSummary}
          </p>
        )}
      </div>

      {/* Pending reminder badge */}
      {row.reminderAt && !row.reminderFiredAt && (
        <span
          className="flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium"
          style={{
            backgroundColor: "oklch(0.93 0.10 60 / 0.20)",
            color: "oklch(0.50 0.15 60)",
          }}
          title={`Rappel programmé : ${new Date(row.reminderAt).toLocaleString("fr-FR")}`}
        >
          <Bell size={10} weight="fill" />
          {formatCompactDate(row.reminderAt)}
        </span>
      )}

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

      {/* Email source : tâche créée depuis un email → badge TOUJOURS visible
          (« c'est lié à un email ») + clic ouvre le fil (deep-link /mail). */}
      {row.sourceThreadId && (
        <Link
          href={`/mail?thread=${row.sourceThreadId}`}
          prefetch={false}
          onClick={(e) => e.stopPropagation()}
          className="flex min-w-0 shrink items-center gap-1 rounded px-1.5 py-0.5 text-[10px]"
          style={{ color: "var(--accent)", background: "var(--accent-subtle)" }}
          title={row.sourceFromName ? `Email de ${row.sourceFromName} — ouvrir` : "Ouvrir l'email source"}
        >
          <Envelope size={11} />
          <span className="truncate">{row.sourceFromName || "Email"}</span>
        </Link>
      )}

      {/* Email button */}
      {onEmail && (
        <Button
          variant="ghost"
          onPress={onEmail}
          aria-label="Envoyer par email"
          className="flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[10px] opacity-0 transition-opacity group-hover:opacity-100 min-w-0 h-auto"
          style={{ color: "var(--text-muted)" }}
        >
          <Envelope size={11} />
        </Button>
      )}

      {/* Date display — range, single due, or single start */}
      {row.startDate && row.dueDate && row.startDate !== row.dueDate ? (
        <span
          className="mt-0.5 shrink-0 text-[10px] tabular-nums"
          style={{ color: "var(--text-muted)" }}
          title={`Début : ${formatFullDate(row.startDate)} → Échéance : ${formatFullDate(row.dueDate)}`}
        >
          {formatCompactDate(row.startDate)} → {formatCompactDate(row.dueDate)}
        </span>
      ) : row.dueDate ? (
        <span
          className="mt-0.5 shrink-0 text-[10px] tabular-nums"
          style={{ color: "var(--text-muted)" }}
          title={`Échéance : ${formatFullDate(row.dueDate)}`}
        >
          {formatCompactDate(row.dueDate)}
        </span>
      ) : row.startDate ? (
        <span
          className="mt-0.5 shrink-0 text-[10px] tabular-nums"
          style={{ color: "var(--text-muted)" }}
          title={`Depuis le : ${formatFullDate(row.startDate)}`}
        >
          depuis {formatCompactDate(row.startDate)}
        </span>
      ) : null}
    </li>
  );
}
