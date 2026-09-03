"use client";

/**
 * OnThisDay — encart madeleine de l'accueil : ce que tu écrivais à la même
 * date il y a un an (et six mois). Invisible quand il n'y a rien — zéro bruit,
 * donc pas de squelette ni de message d'erreur : son absence est le cas normal.
 * S'appuie sur entities.listByDateRange (worker, SQL sur createdAt).
 */

import { useMemo } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { ClockCounterClockwise } from "@phosphor-icons/react";
import { trpc } from "@/lib/trpc/client";
import { entityDisplayName } from "@/components/notes/adapters";
import { HOME_ROW_CLASS } from "./HomeSection";

const MAX_ITEMS = 4;
const PER_WINDOW = 3;

/** Bornes [from, to) du jour courant décalé de `monthsBack` mois en arrière. */
function dayWindow(monthsBack: number): { from: string; to: string } {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() - monthsBack, now.getDate());
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { from: start.toISOString(), to: end.toISOString() };
}

/** Extrait plein-texte court d'un body markdown. */
function excerptOf(body: string | undefined): string {
  if (!body) return "";
  return body
    .replace(/^#+\s*/gm, "")
    .replace(/[>*`~_[\]|-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 90);
}

interface Memory {
  id: string;
  title: string;
  excerpt: string;
  period: string;
}

export function OnThisDay() {
  const t = useTranslations("home.onThisDay");

  const yearWindow = useMemo(() => dayWindow(12), []);
  const halfWindow = useMemo(() => dayWindow(6), []);

  const yearQuery = trpc.entities.listByDateRange.useQuery(
    { ...yearWindow, field: "createdAt", typeName: "note", limit: PER_WINDOW },
    { staleTime: 1000 * 60 * 60, retry: false },
  );
  const halfQuery = trpc.entities.listByDateRange.useQuery(
    { ...halfWindow, field: "createdAt", typeName: "note", limit: PER_WINDOW },
    { staleTime: 1000 * 60 * 60, retry: false },
  );

  const yearLabel = t("yearAgo");
  const halfLabel = t("sixMonthsAgo");

  const memories = useMemo<Memory[]>(() => {
    const collected: Memory[] = [];
    for (const [items, period] of [
      [yearQuery.data?.items, yearLabel],
      [halfQuery.data?.items, halfLabel],
    ] as const) {
      for (const e of items ?? []) {
        collected.push({
          id: e.id,
          title: entityDisplayName(e),
          excerpt: excerptOf(e.body),
          period,
        });
      }
    }
    return collected.slice(0, MAX_ITEMS);
  }, [yearQuery.data, halfQuery.data, yearLabel, halfLabel]);

  if (memories.length === 0) return null;

  return (
    <div className="flex flex-col">
      {memories.map((m) => (
        <Link key={m.id} href={`/notes/${m.id}`} prefetch={false} className={HOME_ROW_CLASS}>
          <ClockCounterClockwise
            size={14}
            className="shrink-0"
            style={{ color: "var(--icon-decorative)" }}
            aria-hidden="true"
          />
          <span
            className="shrink-0 max-w-[45%] truncate text-[13px]"
            style={{ color: "var(--text-primary)" }}
          >
            {m.title}
          </span>
          {m.excerpt && (
            <span
              className="hidden min-w-0 flex-1 truncate text-[12px] sm:block"
              style={{ color: "var(--text-secondary)" }}
            >
              {m.excerpt}
            </span>
          )}
          <span
            className="ml-auto shrink-0 text-[12px]"
            style={{ color: "var(--text-muted)" }}
          >
            {m.period}
          </span>
        </Link>
      ))}
    </div>
  );
}
