"use client";

import { ArrowsDownUp, CaretDoubleLeft, FileText, MagnifyingGlass, Plus, SortAscending, Warning } from "@phosphor-icons/react";
import { useMemo, useState } from "react";
import type { Note } from "./fixtures";
import { NoteListItem } from "./NoteListItem";
import { useTranslations } from "next-intl";

type SortKey = "updatedAt" | "title";

interface NoteListProps {
  notes: Note[];
  selectedNoteId: string | null;
  folderName: string | null;
  /**
   * Absolute path of the folder currently selected in the FileTree, e.g.
   * "Inbox/Projects". Used to compute relative sub-folder headers when
   * grouping recursively-fetched notes. `null` means "all notes" (no
   * grouping; everything appears under a single flat list).
   */
  selectedFolder: string | null;
  onSelectNote: (id: string) => void;
  isLoading?: boolean;
  isError?: boolean;
  errorMessage?: string | null;
  isFallback?: boolean;
  onNewNote?: () => void;
  onDeleteNote?: (id: string) => void;
  /**
   * Optional collapse handler — when provided, a small chevron button is
   * rendered in the header that hides the NoteList column. State is owned
   * by the parent (persisted in localStorage at the page level).
   */
  onCollapse?: () => void;
}

export function NoteList({
  notes,
  selectedNoteId,
  folderName,
  selectedFolder,
  onSelectNote,
  isLoading = false,
  isError = false,
  errorMessage = null,
  isFallback = false,
  onNewNote,
  onDeleteNote,
  onCollapse,
}: NoteListProps) {
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("updatedAt");
  const t = useTranslations("notes");
  const tCommon = useTranslations("common");

  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim();
    const matched = q
      ? notes.filter(
          (n) =>
            n.title.toLowerCase().includes(q) ||
            n.body.toLowerCase().includes(q) ||
            n.tags.some((t) => t.toLowerCase().includes(q)),
        )
      : notes;

    return [...matched].sort((a, b) => {
      if (sortKey === "title") return a.title.localeCompare(b.title, "fr");
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    });
  }, [notes, query, sortKey]);

  /**
   * Bucket the (already filtered + sorted) notes by their location relative
   * to `selectedFolder`:
   *   - the "" key holds notes that live directly in the selected folder
   *   - every other key is a relative sub-path ("Sub1", "Sub1/Deep", …)
   *
   * When no folder is selected (All notes) we skip grouping and return a
   * single anonymous bucket so the existing flat render is preserved.
   */
  const groups = useMemo(() => {
    if (!selectedFolder) {
      return [{ key: "", label: null as string | null, notes: filtered }];
    }
    const prefix = `${selectedFolder}/`;
    const buckets = new Map<string, Note[]>();
    for (const n of filtered) {
      let rel = "";
      if (n.folderPath === selectedFolder) {
        rel = "";
      } else if (n.folderPath.startsWith(prefix)) {
        rel = n.folderPath.slice(prefix.length);
      } else {
        // Defensive: a note that doesn't belong to the subtree shouldn't
        // reach us, but if it does we keep it under the root bucket rather
        // than dropping it silently.
        rel = "";
      }
      const bucket = buckets.get(rel);
      if (bucket) bucket.push(n);
      else buckets.set(rel, [n]);
    }
    const root = buckets.get("") ?? [];
    buckets.delete("");
    const subs = [...buckets.entries()]
      .sort(([a], [b]) => a.localeCompare(b, "fr"))
      .map(([key, ns]) => ({ key, label: key, notes: ns }));
    const result: { key: string; label: string | null; notes: Note[] }[] = [];
    if (root.length > 0) result.push({ key: "", label: t("thisFolder"), notes: root });
    result.push(...subs);
    return result;
  }, [filtered, selectedFolder, t]);

  const toggleSort = () =>
    setSortKey((k) => (k === "updatedAt" ? "title" : "updatedAt"));

  return (
    <div
      className="flex h-full flex-col border-r"
      style={{
        width: 320,
        minWidth: 320,
        borderColor: "var(--border-subtle)",
        backgroundColor: "var(--surface-0)",
      }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-3"
        style={{ borderBottom: "1px solid var(--border-subtle)" }}
      >
        <div className="flex items-center gap-2">
          <span
            className="text-sm font-semibold"
            style={{ color: "var(--text-primary)" }}
          >
            {folderName ?? t("allNotes")}
          </span>
          {/* Recursive count badge — `notes` is already the recursive set
              (useNoteList includes descendants), so this number reflects
              everything visible in the grouped list below. Hidden during
              load + when there's nothing to count to avoid flashing "0". */}
          {!isLoading && !isError && notes.length > 0 && (
            <span
              className="rounded px-1.5 py-0.5 text-[10px] font-medium tabular-nums"
              style={{ backgroundColor: "var(--surface-2)", color: "var(--text-muted)" }}
            >
              {notes.length}
            </span>
          )}
          {isFallback && (
            <span
              className="rounded px-1.5 py-0.5 text-[10px] font-medium"
              style={{ backgroundColor: "var(--surface-3)", color: "var(--text-muted)" }}
            >
              demo
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {onNewNote && (
            <button
              onClick={onNewNote}
              aria-label={t("newNote")}
              className="flex h-6 w-6 items-center justify-center rounded-md transition-colors hover:bg-[var(--surface-2)]"
              style={{ color: "var(--text-muted)" }}
            >
              <Plus size={13} />
            </button>
          )}
          <button
            onClick={toggleSort}
            aria-label={t("changeSort")}
            className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs transition-colors hover:bg-[var(--surface-2)]"
            style={{ color: "var(--text-muted)" }}
          >
            {sortKey === "updatedAt" ? <ArrowsDownUp size={12} /> : <SortAscending size={12} />}
            {sortKey === "updatedAt" ? tCommon("date") : tCommon("title")}
          </button>
          {onCollapse && (
            <button
              onClick={onCollapse}
              aria-label="Réduire la liste"
              title="Réduire la liste"
              className="flex h-6 w-6 items-center justify-center rounded-md transition-colors hover:bg-[var(--surface-2)]"
              style={{ color: "var(--text-muted)" }}
            >
              <CaretDoubleLeft size={13} />
            </button>
          )}
        </div>
      </div>

      {/* Search */}
      <div className="px-3 py-2" style={{ borderBottom: "1px solid var(--border-subtle)" }}>
        <div className="relative">
          <MagnifyingGlass
            size={13}
            className="absolute left-2.5 top-1/2 -translate-y-1/2"
            style={{ color: "var(--text-muted)" }}
          />
          <input
            type="text"
            placeholder={tCommon("search")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full rounded-md py-1.5 pl-8 pr-3 text-xs outline-none"
            style={{
              backgroundColor: "var(--surface-2)",
              color: "var(--text-primary)",
              border: "1px solid var(--border-subtle)",
            }}
          />
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <NoteListSkeleton />
        ) : isError ? (
          <NoteListError message={errorMessage} />
        ) : filtered.length === 0 ? (
          <EmptyNoteList hasQuery={query.length > 0} onNewNote={onNewNote} />
        ) : (
          // Render bucketed groups. When `selectedFolder` is null we only
          // produce one group with `label: null` — same flat layout as
          // before. When a folder is selected we render a small sticky-ish
          // section header per sub-path so it's obvious which sub-folder a
          // note belongs to.
          groups.map((group) => (
            <section key={group.key || "__root__"}>
              {group.label && (
                <div
                  className="px-4 py-1.5 text-[10px] font-semibold uppercase tracking-wide"
                  style={{
                    backgroundColor: "var(--surface-1)",
                    color: "var(--text-muted)",
                    borderBottom: "1px solid var(--border-subtle)",
                  }}
                >
                  {group.label}
                </div>
              )}
              {group.notes.map((note) => (
                <NoteListItem
                  key={note.id}
                  note={note}
                  isActive={note.id === selectedNoteId}
                  onClick={() => onSelectNote(note.id)}
                  onDelete={onDeleteNote ? () => onDeleteNote(note.id) : undefined}
                />
              ))}
            </section>
          ))
        )}
      </div>

      {/* Footer */}
      <div
        className="px-4 py-2"
        style={{ borderTop: "1px solid var(--border-subtle)" }}
      >
        <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
          {isLoading ? tCommon("loading") : `${filtered.length} note${filtered.length !== 1 ? "s" : ""}`}
        </span>
      </div>
    </div>
  );
}

function NoteListSkeleton() {
  return (
    <div className="space-y-0">
      {[1, 2, 3, 4].map((i) => (
        <div key={i} className="animate-pulse px-4 py-3" style={{ borderBottom: "1px solid var(--border-subtle)" }}>
          <div className="flex justify-between gap-2">
            <div className="h-4 w-2/3 rounded" style={{ backgroundColor: "var(--surface-2)" }} />
            <div className="h-3 w-10 rounded" style={{ backgroundColor: "var(--surface-2)" }} />
          </div>
          <div className="mt-2 h-3 w-full rounded" style={{ backgroundColor: "var(--surface-2)" }} />
          <div className="mt-1 h-3 w-4/5 rounded" style={{ backgroundColor: "var(--surface-2)" }} />
        </div>
      ))}
    </div>
  );
}

function NoteListError({ message }: { message: string | null }) {
  const t = useTranslations("notes");
  const tCommon = useTranslations("common");

  return (
    <div className="flex flex-col items-center justify-center gap-3 p-8 text-center">
      <Warning size={32} style={{ color: "var(--color-red-400, #f87171)" }} />
      <div>
        <p className="text-sm font-medium" style={{ color: "var(--text-secondary)" }}>
          {t("cannotLoad")}
        </p>
        <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
          {message ?? t("loadError")}
        </p>
      </div>
    </div>
  );
}

function EmptyNoteList({
  hasQuery,
  onNewNote,
}: {
  hasQuery: boolean;
  onNewNote?: () => void;
}) {
  const t = useTranslations("notes");
  const tCommon = useTranslations("common");

  if (hasQuery) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 p-8 text-center">
        <FileText size={32} style={{ color: "var(--border)" }} />
        <div>
          <p className="text-sm font-medium" style={{ color: "var(--text-secondary)" }}>
            {tCommon("noResults")}
          </p>
          <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
            {tCommon("tryOtherSearch")}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center gap-4 p-8 text-center">
      <div
        className="flex h-14 w-14 items-center justify-center rounded-2xl"
        style={{ backgroundColor: "var(--accent-subtle)" }}
      >
        <FileText size={24} style={{ color: "var(--accent)" }} />
      </div>
      <div>
        <p className="text-sm font-medium" style={{ color: "var(--text-secondary)" }}>
          {t("emptyFolder")}
        </p>
        <p className="mt-1 text-xs leading-relaxed" style={{ color: "var(--text-muted)" }}>
          {t("emptyFolderHint").split("\n").map((line, i) => (
            <span key={i}>{line}{i === 0 ? <br /> : null}</span>
          ))}
        </p>
      </div>
      {onNewNote && (
        <button
          onClick={onNewNote}
          className="flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-medium transition-opacity hover:opacity-90"
          style={{ backgroundColor: "var(--accent)", color: "var(--accent-foreground)" }}
        >
          <Plus size={13} />
          {t("createFirstNote")}
        </button>
      )}
    </div>
  );
}
