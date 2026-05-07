"use client";

import { ArrowsDownUp, FileText, MagnifyingGlass, Plus, SortAscending, Warning } from "@phosphor-icons/react";
import { useMemo, useState } from "react";
import type { Note } from "./fixtures";
import { NoteListItem } from "./NoteListItem";

type SortKey = "updatedAt" | "title";

interface NoteListProps {
  notes: Note[];
  selectedNoteId: string | null;
  folderName: string | null;
  onSelectNote: (id: string) => void;
  isLoading?: boolean;
  isError?: boolean;
  errorMessage?: string | null;
  isFallback?: boolean;
  onNewNote?: () => void;
  onDeleteNote?: (id: string) => void;
}

export function NoteList({
  notes,
  selectedNoteId,
  folderName,
  onSelectNote,
  isLoading = false,
  isError = false,
  errorMessage = null,
  isFallback = false,
  onNewNote,
  onDeleteNote,
}: NoteListProps) {
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("updatedAt");

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
            {folderName ?? "Toutes les notes"}
          </span>
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
              aria-label="Nouvelle note"
              className="flex h-6 w-6 items-center justify-center rounded-md transition-colors hover:bg-[var(--surface-2)]"
              style={{ color: "var(--text-muted)" }}
            >
              <Plus size={13} />
            </button>
          )}
          <button
            onClick={toggleSort}
            aria-label="Changer le tri"
            className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs transition-colors hover:bg-[var(--surface-2)]"
            style={{ color: "var(--text-muted)" }}
          >
            {sortKey === "updatedAt" ? <ArrowsDownUp size={12} /> : <SortAscending size={12} />}
            {sortKey === "updatedAt" ? "Date" : "Titre"}
          </button>
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
            placeholder="Rechercher…"
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
          filtered.map((note) => (
            <NoteListItem
              key={note.id}
              note={note}
              isActive={note.id === selectedNoteId}
              onClick={() => onSelectNote(note.id)}
              onDelete={onDeleteNote ? () => onDeleteNote(note.id) : undefined}
            />
          ))
        )}
      </div>

      {/* Footer */}
      <div
        className="px-4 py-2"
        style={{ borderTop: "1px solid var(--border-subtle)" }}
      >
        <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
          {isLoading ? "Chargement…" : `${filtered.length} note${filtered.length !== 1 ? "s" : ""}`}
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
  return (
    <div className="flex flex-col items-center justify-center gap-3 p-8 text-center">
      <Warning size={32} style={{ color: "var(--color-red-400, #f87171)" }} />
      <div>
        <p className="text-sm font-medium" style={{ color: "var(--text-secondary)" }}>
          Impossible de charger les notes
        </p>
        <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
          {message ?? "Une erreur est survenue"}
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
  if (hasQuery) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 p-8 text-center">
        <FileText size={32} style={{ color: "var(--border)" }} />
        <div>
          <p className="text-sm font-medium" style={{ color: "var(--text-secondary)" }}>
            Aucun résultat
          </p>
          <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
            Essayez un autre terme de recherche
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
          Dossier vide
        </p>
        <p className="mt-1 text-xs leading-relaxed" style={{ color: "var(--text-muted)" }}>
          Créez votre première note<br />ou importez depuis Notion / Obsidian
        </p>
      </div>
      {onNewNote && (
        <button
          onClick={onNewNote}
          className="flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-medium transition-opacity hover:opacity-90"
          style={{ backgroundColor: "var(--accent)", color: "var(--accent-foreground)" }}
        >
          <Plus size={13} />
          Créer ma première note
        </button>
      )}
    </div>
  );
}
