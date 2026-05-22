"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Card } from "@heroui/react";
import { FileText } from "@phosphor-icons/react";
import { useTranslations } from "next-intl";
import { trpc } from "@/lib/trpc/client";
import type { EntitySummary } from "@supernote/ipc";

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
  const router = useRouter();

  const { data } = trpc.entities.list.useQuery(
    { typeId: "note", limit: 5, offset: 0 },
    { staleTime: 60_000, retry: false },
  );

  const notes = useMemo(() => {
    return [...(data?.items ?? [])]
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      .slice(0, 5);
  }, [data]);

  return (
    <Card className="border p-4 flex flex-col gap-2.5 shadow-none">
      <div className="flex items-center gap-2">
        <span
          className="text-[12px] font-bold uppercase tracking-wider"
          style={{ color: "var(--text-muted)" }}
        >
          {t("title")}
        </span>
        <Link
          href="/notes"
          prefetch={false}
          className="ml-auto text-[12px] hover:underline"
          style={{ color: "var(--text-muted)" }}
        >
          {t("viewAll")}
        </Link>
      </div>

      {notes.length === 0 ? (
        <p className="text-[13px] italic" style={{ color: "var(--text-muted)" }}>
          {t("empty")}
        </p>
      ) : (
        notes.map((note) => (
          <button
            key={note.id}
            type="button"
            onClick={() => router.push(`/notes/${note.id}`)}
            className="flex items-start gap-2 rounded-md px-1 py-1 transition-colors hover:bg-[var(--surface-2)] w-full text-left"
          >
            <FileText size={16} className="shrink-0 mt-0.5" style={{ color: "var(--text-muted)" }} />
            <div className="flex flex-col min-w-0">
              <span
                className="truncate text-[13px] font-medium"
                style={{ color: "var(--text-primary)" }}
              >
                {noteTitle(note)}
              </span>
              <span
                className="truncate text-[11px]"
                style={{ color: "var(--text-muted)" }}
              >
                {snippetFromBody(note.body, t("noBody"))}
              </span>
            </div>
          </button>
        ))
      )}
    </Card>
  );
}
