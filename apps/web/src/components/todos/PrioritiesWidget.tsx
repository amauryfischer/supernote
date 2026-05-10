"use client";

/**
 * PrioritiesWidget — top-N urgent todos for the right sidebar.
 *
 * Surfaces the same shortlist the user gets when they click "Urgentes" on
 * the /todos page (importance=critical OR priority<=3, undone only). Capped
 * at 5 rows to keep the panel compact; clicking a row deep-links to /todos.
 *
 * Source: pure projection of every note's markdown body (notes-derived
 * todos) merged with standalone `todo` entities. Same model as /todos.
 */

import Link from "next/link";
import { useMemo } from "react";
import { Warning } from "@phosphor-icons/react";
import { trpc } from "@/lib/trpc/client";
import { TODO_TYPE_ID } from "@/hooks/useTodoSync";
import { extractChecklists } from "@/lib/todos/extractChecklists";
import { filterChecklistsHeuristic } from "@/lib/todos/heuristicFilter";
import { importanceColor } from "./TodoRow";
import type { TodoImportance } from "./TodoRow";
import { InlineMarkdown } from "@/lib/inlineMarkdown";

const MAX_ROWS = 5;

interface MiniRow {
  id: string;
  text: string;
  priority: number;
  importance: TodoImportance | null;
  sourceNoteId: string | null;
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

export function PrioritiesWidget() {
  const notesQuery = trpc.entities.list.useQuery(
    { typeId: "note", limit: 5000, offset: 0 },
    { staleTime: 60_000, retry: false },
  );
  const todosQuery = trpc.entities.list.useQuery(
    { typeId: TODO_TYPE_ID, limit: 5000, offset: 0 },
    { staleTime: 60_000, retry: false },
  );

  const rows = useMemo<MiniRow[]>(() => {
    const collected: MiniRow[] = [];

    // Notes-derived rows.
    for (const n of notesQuery.data?.items ?? []) {
      const body = typeof n.body === "string" ? n.body : "";
      if (!body || !body.includes("[")) continue;
      const items = extractChecklists(body);
      if (items.length === 0) continue;
      const kept = filterChecklistsHeuristic(body, items);
      for (const it of kept) {
        if (it.done) continue;
        const isUrgent = it.importance === "critical" || it.priority <= 3;
        if (!isUrgent) continue;
        collected.push({
          id: `note:${n.id}:${it.blockId}`,
          text: it.text,
          priority: it.priority,
          importance: it.importance,
          sourceNoteId: n.id,
        });
      }
    }

    // Standalone entities.
    for (const e of todosQuery.data?.items ?? []) {
      const f = e.fields ?? {};
      const sn = f["sourceNoteId"];
      // Skip legacy note-derived entities — covered by the projection above
      // (or pending migration). Otherwise the widget would double-count.
      if (typeof sn === "string" && sn) continue;
      const done = f["done"] === true || f["done"] === "true";
      if (done) continue;
      const importance = parseImportance(f["importance"]);
      const priority = parsePriority(f["priority"]);
      if (!(importance === "critical" || priority <= 3)) continue;
      collected.push({
        id: e.id,
        text: typeof f["text"] === "string" ? (f["text"] as string) : "(sans texte)",
        priority,
        importance,
        sourceNoteId: null,
      });
    }

    return collected
      .sort((a, b) => {
        if (a.importance === "critical" && b.importance !== "critical") return -1;
        if (a.importance !== "critical" && b.importance === "critical") return 1;
        return a.priority - b.priority;
      })
      .slice(0, MAX_ROWS);
  }, [notesQuery.data, todosQuery.data]);

  if (notesQuery.isError && todosQuery.isError) return null;

  return (
    <div className="flex flex-col gap-1 p-3">
      <div className="flex items-center gap-1.5 px-1 pb-2">
        <Warning size={12} style={{ color: "#EF4444" }} />
        <span className="text-xs font-medium" style={{ color: "var(--text-muted)" }}>
          Mes priorités
        </span>
        <Link
          href="/todos"
          prefetch={false}
          className="ml-auto text-[10px] hover:underline"
          style={{ color: "var(--text-muted)" }}
        >
          Voir tout →
        </Link>
      </div>
      {rows.length === 0 ? (
        <p
          className="rounded-md px-3 py-2 text-[11px] leading-relaxed"
          style={{ color: "var(--text-muted)", backgroundColor: "var(--surface-2)" }}
        >
          Aucune priorité urgente.
        </p>
      ) : (
        rows.map((row) => (
          <Link
            key={row.id}
            href="/todos"
            prefetch={false}
            className="flex items-center gap-2 rounded-md px-2 py-1.5 transition-colors hover:bg-[var(--surface-2)]"
          >
            <span
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ backgroundColor: importanceColor(row.importance) }}
            />
            <span
              className="inline-flex h-4 min-w-[1.5rem] shrink-0 items-center justify-center rounded px-1 text-[9px] font-bold tabular-nums"
              style={{
                backgroundColor: "var(--surface-3)",
                color: "var(--text-muted)",
              }}
            >
              P{row.priority}
            </span>
            <span
              className="flex-1 truncate text-xs"
              style={{ color: "var(--text-primary)" }}
            >
              <InlineMarkdown text={row.text} />
            </span>
          </Link>
        ))
      )}
    </div>
  );
}
