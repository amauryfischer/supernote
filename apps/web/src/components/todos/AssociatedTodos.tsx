"use client";

/**
 * AssociatedTodos — compact list of todos extracted from a given note.
 *
 * Pure projection of the note's markdown body — no entity lookup, no
 * cache, no sync. The parent (NoteEditor) passes the freshest body and
 * we re-derive the list on every render. This is the read-side of the
 * post-refactor architecture: the source of truth is the markdown.
 *
 * Each row is read-only — clicking it deep-links to /todos where the
 * full editor lives.
 */

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@heroui/react";
import { CaretDown, CaretRight, CheckSquare } from "@phosphor-icons/react";
import { extractChecklists } from "@/lib/todos/extractChecklists";
import { filterChecklistsHeuristic } from "@/lib/todos/heuristicFilter";
import { importanceColor, importanceLabel } from "./TodoRow";
import { useDateFormat } from "@/lib/dateFormat";
import { InlineMarkdown } from "@/lib/inlineMarkdown";

interface AssociatedTodosProps {
  noteId: string;
  /** The note's current markdown body. Parent passes the live value so the
   *  list updates as the user edits without any debounce / round-trip. */
  body: string;
}

// Hidden by default — the user explicitly asked for this section to stay
// out of the way. The toggle persists in localStorage so the user's
// preference (collapsed vs expanded) sticks across notes and reloads.
const STORAGE_KEY = "supernote.editor.associatedTodosExpanded";

function readExpandedPref(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function writeExpandedPref(value: boolean) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, value ? "1" : "0");
  } catch {
    /* quota / disabled storage — best-effort */
  }
}

export function AssociatedTodos({ noteId, body }: AssociatedTodosProps) {
  const { compact: formatCompactDate, full: formatFullDate } = useDateFormat();
  const [expanded, setExpanded] = useState<boolean>(() => readExpandedPref());
  useEffect(() => {
    writeExpandedPref(expanded);
  }, [expanded]);

  const rows = useMemo(() => {
    const items = extractChecklists(body);
    if (items.length === 0) return [];
    const kept = filterChecklistsHeuristic(body, items);
    // Stable order: pending first, then by priority ascending (1 = most
    // urgent), then by line index for ties.
    return [...kept].sort((a, b) => {
      if (a.done !== b.done) return a.done ? 1 : -1;
      if (a.priority !== b.priority) return a.priority - b.priority;
      return a.line - b.line;
    });
  }, [body]);

  if (rows.length === 0) return null;

  return (
    <div
      className="mx-10 my-6 rounded-lg"
      style={{
        backgroundColor: "var(--surface-1)",
        border: "1px solid var(--border-subtle)",
      }}
    >
      {/* Header row — always visible, always clickable to toggle. */}
      <Button
        variant="ghost"
        onPress={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="flex w-full items-center gap-2 rounded-lg px-4 py-2 transition-colors hover:bg-[var(--surface-2)]"
      >
        {expanded ? (
          <CaretDown size={11} style={{ color: "var(--text-muted)" }} />
        ) : (
          <CaretRight size={11} style={{ color: "var(--text-muted)" }} />
        )}
        <CheckSquare size={14} style={{ color: "var(--accent)" }} />
        <span
          className="sn-eyebrow"
        >
          Tâches associées ({rows.length})
        </span>
        <Link
          href={`/todos?note=${encodeURIComponent(noteId)}`}
          prefetch={false}
          onClick={(e) => e.stopPropagation()}
          className="ml-auto text-[11px] hover:underline"
          style={{ color: "var(--accent)" }}
        >
          Tout voir →
        </Link>
      </Button>
      {expanded ? <div className="px-4 pb-4 pt-1">
      <ul className="flex flex-col gap-1">
        {rows.map((row) => (
          <li
            key={row.blockId}
            className="flex items-center gap-2 rounded px-2 py-1 text-sm"
            style={{
              color: row.done ? "var(--text-muted)" : "var(--text-primary)",
              textDecoration: row.done ? "line-through" : undefined,
            }}
          >
            <span
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ backgroundColor: importanceColor(row.importance) }}
              title={`Importance : ${importanceLabel(row.importance)}`}
            />
            <span
              className="inline-flex h-4 min-w-[1.5rem] shrink-0 items-center justify-center rounded px-1 text-[10px] font-bold tabular-nums"
              style={{ backgroundColor: "var(--surface-3)", color: "var(--text-muted)" }}
            >
              P{row.priority}
            </span>
            <span className="flex-1 truncate">
              <InlineMarkdown text={row.text} />
            </span>
            {row.startDate && row.dueDate && row.startDate !== row.dueDate ? (
              <span
                className="shrink-0 text-[10px] tabular-nums"
                style={{ color: "var(--text-muted)" }}
                title={`Début : ${formatFullDate(row.startDate)} → Échéance : ${formatFullDate(row.dueDate)}`}
              >
                {formatCompactDate(row.startDate)} → {formatCompactDate(row.dueDate)}
              </span>
            ) : row.dueDate ? (
              <span
                className="shrink-0 text-[10px] tabular-nums"
                style={{ color: "var(--text-muted)" }}
                title={`Échéance : ${formatFullDate(row.dueDate)}`}
              >
                {formatCompactDate(row.dueDate)}
              </span>
            ) : row.startDate ? (
              <span
                className="shrink-0 text-[10px] tabular-nums"
                style={{ color: "var(--text-muted)" }}
                title={`Depuis le : ${formatFullDate(row.startDate)}`}
              >
                depuis {formatCompactDate(row.startDate)}
              </span>
            ) : null}
            {row.done && (
              <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                ✓
              </span>
            )}
          </li>
        ))}
      </ul>
      </div> : null}
    </div>
  );
}
