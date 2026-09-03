"use client";

import Link from "next/link";
import { useMemo } from "react";
import { Chip } from "@heroui/react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { trpc } from "@/lib/trpc/client";
import { TODO_TYPE_ID } from "@/hooks/useTodoSync";
import { extractChecklists } from "@/lib/todos/extractChecklists";
import { filterChecklistsHeuristic } from "@/lib/todos/heuristicFilter";
import { importanceColor } from "@/components/todos/TodoRow";
import type { TodoImportance } from "@/components/todos/TodoRow";
import { HomeSection, HOME_ROW_CLASS, SectionSkeleton, SectionNotice } from "./HomeSection";

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
  const tCommon = useTranslations("home");
  const router = useRouter();

  // Les notes gardent leur body : extractChecklists parse le markdown complet.
  // (Scan client-side coûteux — candidat à un endpoint worker dédié plus tard.)
  const notesQuery = trpc.entities.list.useQuery(
    { typeId: "note", limit: 5000, offset: 0 },
    { staleTime: 60_000, retry: false },
  );
  // Les todos sont pilotés par champs (pas de body) → résumés suffisent.
  const todosQuery = trpc.entities.listSummaries.useQuery(
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

  const isLoading = notesQuery.isLoading || todosQuery.isLoading;
  // Une seule source en échec laisse encore une liste partielle exploitable :
  // on ne bascule en erreur que si l'écran n'a plus rien d'honnête à montrer.
  const hasError = notesQuery.isError || todosQuery.isError;

  return (
    <HomeSection
      title={t("title")}
      meta={
        !isLoading && rows.length > 0 ? (
          <Chip size="sm" color="warning" variant="soft">
            {t("urgentCount", { n: rows.length })}
          </Chip>
        ) : undefined
      }
      action={{ label: t("viewAll"), href: "/todos" }}
    >
      {isLoading ? (
        <SectionSkeleton rows={3} />
      ) : hasError && rows.length === 0 ? (
        <SectionNotice
          tone="danger"
          action={{
            label: tCommon("retry"),
            onClick: () => {
              void notesQuery.refetch();
              void todosQuery.refetch();
            },
          }}
        >
          {t("error")}
        </SectionNotice>
      ) : rows.length === 0 ? (
        <SectionNotice
          action={{ label: t("emptyAction"), onClick: () => router.push("/todos?new=1") }}
        >
          {t("empty")}
        </SectionNotice>
      ) : (
        <div className="flex flex-col">
          {rows.map((row) => (
            <Link key={row.id} href="/todos" prefetch={false} className={HOME_ROW_CLASS}>
              <span
                aria-hidden="true"
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: importanceColor(row.importance) }}
              />
              <span
                className="flex-1 truncate text-[13px]"
                style={{ color: "var(--text-primary)" }}
              >
                {row.text}
              </span>
              <span
                className="shrink-0 rounded-[var(--radius-sm)] px-1 text-[11px] font-medium tabular-nums"
                style={{ backgroundColor: "var(--surface-2)", color: "var(--text-secondary)" }}
              >
                P{row.priority}
              </span>
            </Link>
          ))}
        </div>
      )}
    </HomeSection>
  );
}
