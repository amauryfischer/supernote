"use client";

/**
 * MoveNoteModal — pick a destination folder to move the current note into.
 *
 * Shows a flat, searchable list of every folder in the vault (rendered as
 * full slash-separated paths so deep hierarchies stay legible). The folder
 * the note already lives in is highlighted and disabled — selecting it is
 * a no-op.
 *
 * Submission is two clicks: pick the folder, the modal closes and calls
 * `onConfirm(newFolderPath)`. The caller is responsible for the actual
 * `entities.update({ filePath })` round-trip.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { FolderSimple, MagnifyingGlass } from "@phosphor-icons/react";

interface MoveNoteModalProps {
  open: boolean;
  /** Folder paths the user can pick from, e.g. ["Inbox", "Travail/2025"]. */
  folders: string[];
  /** The folder the note currently sits in — disabled in the list. */
  currentFolder: string;
  onConfirm: (nextFolder: string) => void;
  onCancel: () => void;
}

export function MoveNoteModal({
  open,
  folders,
  currentFolder,
  onConfirm,
  onCancel,
}: MoveNoteModalProps) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQuery("");
      const id = requestAnimationFrame(() => inputRef.current?.focus());
      return () => cancelAnimationFrame(id);
    }
    return undefined;
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    // Always show the current folder at the top so the user keeps context,
    // but mark it disabled. Sort the rest alphabetically.
    const sorted = [...folders].sort((a, b) =>
      a.toLowerCase().localeCompare(b.toLowerCase()),
    );
    if (!q) return sorted;
    return sorted.filter((p) => p.toLowerCase().includes(q));
  }, [folders, query]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-24"
      style={{ backgroundColor: "rgba(0,0,0,0.4)" }}
      onClick={onCancel}
      role="presentation"
    >
      <div
        className="flex w-full max-w-md flex-col overflow-hidden rounded-xl shadow-xl"
        style={{
          backgroundColor: "var(--surface-1)",
          border: "1px solid var(--border-subtle)",
          maxHeight: "min(70vh, 540px)",
        }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="move-note-title"
      >
        <div
          className="flex items-center gap-2 border-b px-4 py-3"
          style={{ borderColor: "var(--border-subtle)" }}
        >
          <FolderSimple size={16} style={{ color: "var(--accent)" }} />
          <h2
            id="move-note-title"
            className="text-sm font-semibold"
            style={{ color: "var(--text-primary)" }}
          >
            Déplacer la note dans…
          </h2>
        </div>

        <label
          className="flex items-center gap-2 border-b px-4 py-2"
          style={{ borderColor: "var(--border-subtle)" }}
        >
          <MagnifyingGlass size={13} style={{ color: "var(--text-muted)" }} />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filtrer les dossiers…"
            className="w-full bg-transparent text-sm outline-none"
            style={{ color: "var(--text-primary)" }}
          />
        </label>

        <ul className="flex-1 overflow-y-auto py-1">
          {filtered.length === 0 ? (
            <li
              className="px-4 py-6 text-center text-sm"
              style={{ color: "var(--text-muted)" }}
            >
              Aucun dossier ne correspond à « {query} »
            </li>
          ) : (
            filtered.map((path) => {
              const isCurrent = path === currentFolder;
              return (
                <li key={path}>
                  <button
                    type="button"
                    disabled={isCurrent}
                    onClick={() => {
                      if (!isCurrent) onConfirm(path);
                    }}
                    className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm transition-colors disabled:cursor-default"
                    style={{
                      color: isCurrent
                        ? "var(--text-muted)"
                        : "var(--text-primary)",
                      backgroundColor: isCurrent
                        ? "var(--surface-2)"
                        : "transparent",
                    }}
                    onMouseEnter={(e) => {
                      if (!isCurrent) {
                        e.currentTarget.style.backgroundColor = "var(--surface-2)";
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (!isCurrent) {
                        e.currentTarget.style.backgroundColor = "transparent";
                      }
                    }}
                  >
                    <FolderSimple
                      size={14}
                      style={{ color: "var(--text-muted)" }}
                    />
                    <span className="flex-1 truncate">{path}</span>
                    {isCurrent && (
                      <span
                        className="text-[10px] uppercase tracking-wide"
                        style={{ color: "var(--text-muted)" }}
                      >
                        actuel
                      </span>
                    )}
                  </button>
                </li>
              );
            })
          )}
        </ul>
      </div>
    </div>
  );
}
