"use client";

import { useMemo } from "react";
import Link from "next/link";
import { Skeleton } from "@supernote/ui";
import { useTranslations } from "next-intl";
import { trpc } from "@/lib/trpc/client";
import { SectionNotice } from "./HomeSection";

const MAX_TAGS = 12;

function extractTags(v: unknown): string[] {
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === "string");
  if (typeof v === "string") return v.split(",").map((s) => s.trim()).filter(Boolean);
  return [];
}

export function TagsCloud() {
  const t = useTranslations("home.widgets.tags");
  const tCommon = useTranslations("home");

  // Résumés sans body : on ne lit que `fields.tags`, inutile de cloner 10 000
  // corps de notes complets.
  const query = trpc.entities.listSummaries.useQuery(
    { typeId: "note", limit: 10000, offset: 0 },
    { staleTime: 60_000, retry: false },
  );

  const topTags = useMemo(() => {
    const counts = new Map<string, number>();
    for (const note of query.data?.items ?? []) {
      for (const tag of extractTags(note.fields["tags"])) {
        counts.set(tag, (counts.get(tag) ?? 0) + 1);
      }
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, MAX_TAGS);
  }, [query.data]);

  if (query.isLoading) {
    return (
      <div className="flex flex-wrap gap-1.5" aria-hidden="true">
        {[0, 1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-6 w-16 rounded-full" />
        ))}
      </div>
    );
  }

  if (query.isError) {
    return (
      <SectionNotice
        tone="danger"
        action={{ label: tCommon("retry"), onClick: () => void query.refetch() }}
      >
        {t("error")}
      </SectionNotice>
    );
  }

  if (topTags.length === 0) {
    return <SectionNotice>{t("empty")}</SectionNotice>;
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {topTags.map(([tag, count]) => (
        <Link
          key={tag}
          href={`/notes?tag=${encodeURIComponent(tag)}`}
          prefetch={false}
          className="inline-flex min-h-[34px] items-center gap-1.5 rounded-full bg-[var(--surface-2)] px-2.5 text-[12px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-3)] hover:text-[var(--text-primary)] md:min-h-[26px]"
        >
          <span className="font-medium">#{tag.replace(/^#/, "")}</span>
          <span className="tabular-nums">{count}</span>
        </Link>
      ))}
    </div>
  );
}
