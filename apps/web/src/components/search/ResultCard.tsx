"use client";

import {
  FileText,
  User,
  BookOpen,
  CalendarBlank,
  Hash,
  FolderOpen,
  Clock,
} from "@phosphor-icons/react";
import type { SearchResult } from "@supernote/ipc";
import type { Icon } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";

interface ResultCardProps {
  result: SearchResult;
  query: string;
  debugMode?: boolean;
}

/**
 * Map an entity to the route that displays it. Mirrors the helper in
 * `command/CommandPalette.tsx` — kept duplicated here (rather than shared
 * via a util) because the type-id ↔ route mapping is page-policy and may
 * diverge as routes evolve.
 */
function entityHref(entityId: string, typeId: string): string {
  const t = typeId.toLowerCase();
  if (t === "personne" || t === "contact") return `/contacts/${entityId}`;
  return `/notes/${entityId}`;
}

const TYPE_ICONS: Record<string, Icon> = {
  note: FileText,
  personne: User,
  ressource: BookOpen,
  journal: CalendarBlank,
};

function highlightMatch(text: string, query: string): React.ReactNode {
  if (!query.trim()) return text;
  const words = query.trim().split(/\s+/).filter((w) => w.length > 2);
  if (words.length === 0) return text;

  const pattern = words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const parts = text.split(new RegExp(`(${pattern})`, "gi"));

  return parts.map((part, i) => {
    const isMatch = words.some((w) => w.toLowerCase() === part.toLowerCase());
    return isMatch ? (
      <mark
        key={i}
        className="rounded px-0.5"
        style={{ backgroundColor: "oklch(0.92 0.12 80)", color: "oklch(0.40 0.14 80)" }}
      >
        {part}
      </mark>
    ) : (
      part
    );
  });
}

export function ResultCard({ result, query, debugMode }: ResultCardProps) {
  const TypeIcon = TYPE_ICONS[result.typeId] ?? FileText;
  const folder = result.filePath.split("/").slice(0, -1).join("/");
  const router = useRouter();

  return (
    <button
      type="button"
      onClick={() => router.push(entityHref(result.entityId, result.typeId))}
      className="w-full cursor-pointer rounded-lg border px-4 py-3 text-left transition-colors active:bg-[var(--surface-2)]"
      style={{
        backgroundColor: "var(--surface-1)",
        borderColor: "var(--border-subtle)",
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLButtonElement).style.backgroundColor = "var(--surface-2)";
        (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--accent)";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLButtonElement).style.backgroundColor = "var(--surface-1)";
        (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--border-subtle)";
      }}
    >
      <div className="flex items-start gap-3">
        <div
          className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md"
          style={{ backgroundColor: "var(--accent-subtle)", color: "var(--accent)" }}
        >
          <TypeIcon size={14} />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <h3 className="truncate text-sm font-medium" style={{ color: "var(--text-primary)" }}>
              {highlightMatch(result.title, query)}
            </h3>
            {debugMode && (
              <span
                className="shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px]"
                style={{ backgroundColor: "var(--surface-2)", color: "var(--text-muted)" }}
              >
                {result.score.toFixed(3)}
              </span>
            )}
          </div>

          {result.excerpts[0] && (
            <p
              className="mt-1 line-clamp-2 text-xs leading-relaxed"
              style={{ color: "var(--text-secondary)" }}
            >
              {highlightMatch(result.excerpts[0], query)}
            </p>
          )}

          <div className="mt-2 flex flex-wrap items-center gap-3">
            {folder && (
              <span
                className="inline-flex items-center gap-1 text-[10px]"
                style={{ color: "var(--text-muted)" }}
              >
                <FolderOpen size={10} />
                {folder}
              </span>
            )}

            {result.tags.map((tag) => (
              <span
                key={tag}
                className="inline-flex items-center gap-0.5 text-[10px]"
                style={{ color: "var(--text-muted)" }}
              >
                <Hash size={9} />
                {tag}
              </span>
            ))}

            {result.semantic && (
              <span
                className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] font-medium"
                style={{ backgroundColor: "oklch(0.92 0.05 295)", color: "oklch(0.45 0.18 295)" }}
              >
                <Clock size={8} />
                sémantique
              </span>
            )}
          </div>
        </div>
      </div>
    </button>
  );
}
