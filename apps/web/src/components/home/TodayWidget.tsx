"use client";

import Link from "next/link";
import { useMemo } from "react";
import { Card, Chip } from "@heroui/react";
import { useTranslations } from "next-intl";
import { trpc } from "@/lib/trpc/client";
import { TODO_TYPE_ID } from "@/hooks/useTodoSync";
import { extractChecklists } from "@/lib/todos/extractChecklists";
import { filterChecklistsHeuristic } from "@/lib/todos/heuristicFilter";
import { importanceColor } from "@/components/todos/TodoRow";
import type { TodoImportance } from "@/components/todos/TodoRow";

const MAX_ROWS = 4;

interface UrgentRow {
  id: string;
  text: string;
  priority: number;
  importance: TodoImportance | null;
}

function parseImportance(v: unknown): TodoImportance | null {
  if (v === "low" || v === "medium" || v === "high" || v === "critical") return v;
  return null;
}

function parsePriority(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return Math.min(9, Math.max(1, Math.round(v)));
  if (typeof v === "string" && v.trim()) {
    const n = Number(v);
    if (Number.isFinite(n)) return Math.min(9, Math.max(1, Math.round(n)));
  }
  return 5;
}

export function TodayWidget() {
  const t = useTranslations("home.widgets.today");

  const notesQuery = trpc.entities.list.useQuery(
    { typeId: "note", limit: 5000, offset: 0 },
    { staleTime: 60_000, retry: false },
  );
  const todosQuery = trpc.entities.list.useQuery(
    { typeId: TODO_TYPE_ID, limit: 5000, offset: 0 },
    { staleTime: 60_000, retry: false },
  );

  const rows = useMemo<UrgentRow[]>(() => {
    const collected: UrgentRow[] = [];

    for (const n of notesQuery.data?.items ?? []) {
      const body = typeof n.body === "string" ? n.body : "";
      if (!body || !body.includes("[")) continue;
      const items = extractChecklists(body);
      if (items.length === 0) continue;
      const kept = filterChecklistsHeuristic(body, items);
      for (const it of kept) {
        if (it.done) continue;
        if (!(it.importance === "critical" || it.priority <= 3)) continue;
        collected.push({
          id: `note:${n.id}:${it.blockId}`,
          text: it.text,
          priority: it.priority,
          importance: it.importance,
        });
      }
    }

    for (const e of todosQuery.data?.items ?? []) {
      const f = e.fields ?? {};
      const sn = f["sourceNoteId"];
      if (typeof sn === "string" && sn) continue;
      const done = f["done"] === true || f["done"] === "true";
      if (done) continue;
      const importance = parseImportance(f["importance"]);
      const priority = parsePriority(f["priority"]);
      if (!(importance === "critical" || priority <= 3)) continue;
      collected.push({
        id: e.id,
        text: typeof f["text"] === "string" ? f["text"] : "(sans texte)",
        priority,
        importance,
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

  return (
    <Card className="border p-4 flex flex-col gap-2.5 shadow-none">
      <div className="flex items-center gap-2">
        <span
          className="text-[12px] font-bold uppercase tracking-wider"
          style={{ color: "var(--text-muted)" }}
        >
          {t("title")}
        </span>
        {rows.length > 0 && (
          <Chip size="sm" color="warning" variant="soft">
            {t("urgentCount", { n: rows.length })}
          </Chip>
        )}
        <Link
          href="/todos"
          prefetch={false}
          className="ml-auto text-[12px] hover:underline"
          style={{ color: "var(--text-muted)" }}
        >
          {t("viewAll")}
        </Link>
      </div>

      {rows.length === 0 ? (
        <p
          className="text-[13px] italic"
          style={{ color: "var(--text-muted)" }}
        >
          {t("empty")}
        </p>
      ) : (
        rows.map((row) => (
          <Link
            key={row.id}
            href="/todos"
            prefetch={false}
            className="flex items-center gap-2 rounded-md px-1 py-1 transition-colors hover:bg-[var(--surface-2)]"
          >
            <span
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ backgroundColor: importanceColor(row.importance) }}
            />
            <span className="flex-1 truncate text-[13px]" style={{ color: "var(--text-primary)" }}>
              {row.text}
            </span>
            <span
              className="shrink-0 text-[11px] font-bold tabular-nums rounded px-1"
              style={{
                backgroundColor: "var(--surface-3)",
                color: "var(--text-muted)",
              }}
            >
              P{row.priority}
            </span>
          </Link>
        ))
      )}
    </Card>
  );
}
