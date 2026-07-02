"use client";

import { useMemo } from "react";
import { Card, Chip } from "@heroui/react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { trpc } from "@/lib/trpc/client";
import type { ChipVariants } from "@heroui/react";

type ChipColor = NonNullable<ChipVariants["color"]>;

const TAG_COLORS: ChipColor[] = [
  "accent",
  "success",
  "warning",
  "danger",
  "default",
  "accent",
];

function extractTags(v: unknown): string[] {
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === "string");
  if (typeof v === "string") return v.split(",").map((s) => s.trim()).filter(Boolean);
  return [];
}

export function TagsCloud() {
  const t = useTranslations("home.widgets.tags");
  const router = useRouter();

  // Résumés sans body : on ne lit que `fields.tags`, inutile de cloner 10 000
  // corps de notes complets.
  const { data } = trpc.entities.listSummaries.useQuery(
    { typeId: "note", limit: 10000, offset: 0 },
    { staleTime: 60_000, retry: false },
  );

  const topTags = useMemo(() => {
    const counts = new Map<string, number>();
    for (const note of data?.items ?? []) {
      for (const tag of extractTags(note.fields["tags"])) {
        counts.set(tag, (counts.get(tag) ?? 0) + 1);
      }
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12);
  }, [data]);

  return (
    <Card className="border shadow-none p-4 flex flex-col gap-3">
      <span
        className="text-[12px] font-bold uppercase tracking-wider"
        style={{ color: "var(--text-muted)" }}
      >
        {t("title")}
      </span>
      {topTags.length === 0 ? (
        <p className="text-[13px] italic" style={{ color: "var(--text-muted)" }}>
          {t("empty")}
        </p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {topTags.map(([tag, count], idx) => (
            <Chip
              key={tag}
              size="sm"
              variant="soft"
              color={TAG_COLORS[idx % TAG_COLORS.length]}
              className="cursor-pointer"
              onClick={() => router.push(`/notes?tag=${encodeURIComponent(tag)}`)}
            >
              {tag}
              <span style={{ opacity: 0.5, fontSize: 10 }}>&nbsp;{count}</span>
            </Chip>
          ))}
        </div>
      )}
    </Card>
  );
}
