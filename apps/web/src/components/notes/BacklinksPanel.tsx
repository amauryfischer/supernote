"use client";

import Link from "next/link";
import { Spinner } from "@heroui/react";
import { LinkSimple } from "@phosphor-icons/react";
import { trpc } from "@/lib/trpc/client";

interface BacklinksPanelProps {
  noteId: string;
}

function stripNoise(text: string): string {
  return text
    .replace(/^---[\s\S]*?---\n?/, "")
    .replace(/!\[.*?\]\(.*?\)/g, "")
    .replace(/\[\[.*?\]\]/g, "")
    .replace(/#{1,6}\s+/g, "")
    .replace(/[*_`~]/g, "")
    .trim()
    .slice(0, 100);
}

export function BacklinksPanel({ noteId }: BacklinksPanelProps) {
  const { data, isLoading, isError } = trpc.entities.getBacklinks.useQuery(
    { id: noteId },
    { staleTime: 30_000 },
  );

  return (
    <div
      className="mx-10 mb-6 mt-2 rounded-lg px-4 py-3"
      style={{ background: "var(--surface-2, #f4f4f5)", border: "1px solid var(--border-subtle)" }}
    >
      <div className="mb-2 flex items-center gap-1.5">
        <LinkSimple size={14} weight="bold" style={{ color: "var(--text-muted)" }} />
        <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
          Liens entrants
        </span>
        {data !== undefined && (
          <span
            className="ml-auto rounded-full px-1.5 py-0.5 text-[10px] font-medium"
            style={{ background: "var(--accent-subtle)", color: "var(--accent)" }}
          >
            {data.length}
          </span>
        )}
      </div>

      {isLoading && (
        <div className="flex items-center gap-2 py-2">
          <Spinner size="sm" />
          <span className="text-xs" style={{ color: "var(--text-muted)" }}>Chargement…</span>
        </div>
      )}

      {isError && (
        <p className="text-xs" style={{ color: "var(--text-muted)" }}>
          Impossible de charger les liens entrants.
        </p>
      )}

      {!isLoading && !isError && data?.length === 0 && (
        <p className="text-xs" style={{ color: "var(--text-muted)" }}>
          Aucune note ne mentionne celle-ci pour le moment.
        </p>
      )}

      {!isLoading && !isError && data && data.length > 0 && (
        <ul className="flex flex-col gap-1">
          {data.map((link) => (
            <li key={link.sourceId} className="group flex flex-col gap-0.5">
              <Link
                href={`/notes/${link.sourceId}`}
                className="text-xs font-medium hover:underline"
                style={{ color: "var(--accent)" }}
              >
                {link.sourceFilePath.split("/").pop()?.replace(/\.[^.]+$/, "") ?? link.sourceId}
              </Link>
              {link.context && (
                <p className="text-[11px] leading-snug" style={{ color: "var(--text-secondary)" }}>
                  {stripNoise(link.context)}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
