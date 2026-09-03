"use client";

import { useMemo } from "react";
import Link from "next/link";
import { FileText } from "@phosphor-icons/react";
import { useTranslations } from "next-intl";
import { trpc } from "@/lib/trpc/client";
import { useShellChrome } from "@/components/shell";
import type { EntitySummary } from "@supernote/ipc";
import { HomeSection, HOME_ROW_CLASS, SectionSkeleton, SectionNotice } from "./HomeSection";

function noteTitle(e: EntitySummary): string {
  const f = e.fields;
  const candidates = [f["name"], f["titre"], f["title"]];
  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) return c.trim();
  }
  const base = e.filePath.split("/").pop() ?? "";
  return base.replace(/\.md$/i, "") || e.id;
}

function snippetFromBody(body: string | undefined, fallback: string): string {
  if (!body) return fallback;
  const stripped = body
    .split("\n")
    .map((line) => line.replace(/^#{1,6}\s+/, "").replace(/^[*\-]\s+/, ""))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  return stripped.slice(0, 80) || fallback;
}

export function ContinueWidget() {
  const t = useTranslations("home.widgets.continue");
  const tCommon = useTranslations("home");
  const shell = useShellChrome();

  const query = trpc.entities.list.useQuery(
    { typeId: "note", limit: 5, offset: 0 },
    { staleTime: 60_000, retry: false },
  );

  const notes = useMemo(() => {
    return [...(query.data?.items ?? [])]
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      .slice(0, 5);
  }, [query.data]);

  return (
    <HomeSection title={t("title")} action={{ label: t("viewAll"), href: "/notes" }}>
      {query.isLoading ? (
        <SectionSkeleton rows={3} />
      ) : query.isError ? (
        <SectionNotice
          tone="danger"
          action={{ label: tCommon("retry"), onClick: () => void query.refetch() }}
        >
          {t("error")}
        </SectionNotice>
      ) : notes.length === 0 ? (
        <SectionNotice action={{ label: t("emptyAction"), onClick: shell.requestNewNote }}>
          {t("empty")}
        </SectionNotice>
      ) : (
        <div className="flex flex-col">
          {notes.map((note) => (
            <Link
              key={note.id}
              href={`/notes/${note.id}`}
              prefetch={false}
              className={HOME_ROW_CLASS}
            >
              <FileText
                size={15}
                className="shrink-0"
                style={{ color: "var(--icon-decorative)" }}
              />
              <span
                className="shrink-0 max-w-[55%] truncate text-[13px] font-medium"
                style={{ color: "var(--text-primary)" }}
              >
                {noteTitle(note)}
              </span>
              <span
                className="hidden min-w-0 flex-1 truncate text-[12px] sm:block"
                style={{ color: "var(--text-secondary)" }}
              >
                {snippetFromBody(note.body, t("noBody"))}
              </span>
            </Link>
          ))}
        </div>
      )}
    </HomeSection>
  );
}
