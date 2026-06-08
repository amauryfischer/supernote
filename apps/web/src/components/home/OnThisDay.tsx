"use client";

/**
 * OnThisDay — encart madeleine de l'accueil : ce que tu écrivais à la même
 * date il y a un an (et six mois). Invisible quand il n'y a rien — zéro bruit.
 * S'appuie sur entities.listByDateRange (worker, SQL sur createdAt).
 */

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Card, Chip } from "@heroui/react";
import { ClockCounterClockwise } from "@phosphor-icons/react";
import { trpc } from "@/lib/trpc/client";
import { entityDisplayName } from "@/components/notes/adapters";

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
    .slice(0, 140);
}

function OnThisDaySection({ label, monthsBack }: { label: string; monthsBack: number }) {
  const t = useTranslations("home.onThisDay");
  const router = useRouter();
  const window = useMemo(() => dayWindow(monthsBack), [monthsBack]);
  const { data } = trpc.entities.listByDateRange.useQuery(
    { from: window.from, to: window.to, field: "createdAt", typeName: "note", limit: 3 },
    { staleTime: 1000 * 60 * 60 },
  );
  const items = data?.items ?? [];
  if (items.length === 0) return null;

  return (
    <div className="mb-4">
      <div
        className="mb-2 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider"
        style={{ color: "var(--text-muted)" }}
      >
        <ClockCounterClockwise size={13} aria-hidden="true" />
        {label}
      </div>
      <div className="flex flex-col gap-2">
        {items.map((e) => {
          const excerpt = excerptOf(e.body);
          return (
            <Card key={e.id}>
              <div
                role="link"
                tabIndex={0}
                aria-label={t("openNote")}
                onClick={() => router.push(`/notes/${e.id}`)}
                onKeyDown={(ev) => {
                  if (ev.key === "Enter" || ev.key === " ") router.push(`/notes/${e.id}`);
                }}
                className="cursor-pointer rounded-xl px-4 py-3 transition-colors"
                style={{
                  backgroundColor: "var(--surface-0)",
                  border: "1px solid var(--border-subtle)",
                }}
              >
                <div
                  className="text-[14px] font-semibold leading-snug"
                  style={{ color: "var(--text-primary)" }}
                >
                  {entityDisplayName(e)}
                </div>
                {excerpt && (
                  <p className="mt-1 text-[12px] leading-relaxed" style={{ color: "var(--text-muted)" }}>
                    {excerpt}
                    {excerpt.length >= 140 ? "…" : ""}
                  </p>
                )}
                {e.tags.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {e.tags.slice(0, 4).map((tag) => (
                      <Chip key={tag} size="sm">
                        #{tag}
                      </Chip>
                    ))}
                  </div>
                )}
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

export function OnThisDay() {
  const t = useTranslations("home.onThisDay");
  return (
    <div>
      <OnThisDaySection label={t("yearAgo")} monthsBack={12} />
      <OnThisDaySection label={t("sixMonthsAgo")} monthsBack={6} />
    </div>
  );
}
