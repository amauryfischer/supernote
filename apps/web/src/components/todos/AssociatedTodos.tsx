"use client";

/**
 * AssociatedTodos — compact list of todos extracted from a given note.
 *
 * Rendered at the bottom of the NoteEditor; shows nothing when the note
 * has no associated todos (zero-cost UI bloat for note types that don't
 * use checklists). Each row is read-only — clicking it deep-links to the
 * /todos page where the full editor lives.
 */

import Link from "next/link";
import { useMemo } from "react";
import { CheckSquare } from "@phosphor-icons/react";
import { trpc } from "@/lib/trpc/client";
import { TODO_TYPE_ID } from "@/hooks/useTodoSync";
import { importanceColor, importanceLabel } from "./TodoRow";
import type { TodoImportance } from "./TodoRow";

interface AssociatedTodosProps {
  noteId: string;
}

interface MiniTodo {
  id: string;
  text: string;
  done: boolean;
  priority: number;
  importance: TodoImportance | null;
}

function parseImportance(v: unknown): TodoImportance | null {
  if (v === "low" || v === "medium" || v === "high" || v === "critical") return v;
  return null;
}

function parsePriority(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) {
    return Math.min(9, Math.max(1, Math.round(v)));
  }
  if (typeof v === "string" && v.trim()) {
    const n = Number(v);
    if (Number.isFinite(n)) return Math.min(9, Math.max(1, Math.round(n)));
    if (v === "low") return 7;
    if (v === "medium") return 5;
    if (v === "high") return 3;
  }
  return 5;
}

export function AssociatedTodos({ noteId }: AssociatedTodosProps) {
  // We list ALL todos (the worker has no `where: {sourceNoteId}` filter) and
  // narrow client-side. The query is shared with the /todos page so the
  // typical scenario is a cache hit, not a fresh round-trip.
  const todosQuery = trpc.entities.list.useQuery(
    { typeId: TODO_TYPE_ID, limit: 1000, offset: 0 },
    { staleTime: 30_000 },
  );

  const rows = useMemo<MiniTodo[]>(() => {
    const items = todosQuery.data?.items ?? [];
    return items
      .filter((e) => {
        const sn = e.fields?.["sourceNoteId"];
        return typeof sn === "string" && sn === noteId;
      })
      .map((e) => {
        const f = e.fields ?? {};
        return {
          id: e.id,
          text: typeof f["text"] === "string" ? (f["text"] as string) : "(sans texte)",
          done: f["done"] === true || f["done"] === "true",
          priority: parsePriority(f["priority"]),
          importance: parseImportance(f["importance"]),
        };
      })
      .sort((a, b) => {
        if (a.done !== b.done) return a.done ? 1 : -1;
        return a.priority - b.priority;
      });
  }, [todosQuery.data, noteId]);

  if (rows.length === 0) return null;

  return (
    <div
      className="mx-10 my-6 rounded-lg p-4"
      style={{ backgroundColor: "var(--surface-1)", border: "1px solid var(--border-subtle)" }}
    >
      <div className="mb-3 flex items-center gap-2">
        <CheckSquare size={14} style={{ color: "var(--accent)" }} />
        <span
          className="text-xs font-medium uppercase tracking-wide"
          style={{ color: "var(--text-muted)" }}
        >
          Tâches associées ({rows.length})
        </span>
        <Link
          href="/todos"
          prefetch={false}
          className="ml-auto text-[11px] hover:underline"
          style={{ color: "var(--accent)" }}
        >
          Tout voir →
        </Link>
      </div>
      <ul className="flex flex-col gap-1">
        {rows.map((row) => (
          <li
            key={row.id}
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
            <span className="flex-1 truncate">{row.text}</span>
            {row.done && (
              <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                ✓
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
