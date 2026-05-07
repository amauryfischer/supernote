"use client";

import { useCallback, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { Calendar, Hash, Tag, FloppyDisk } from "@phosphor-icons/react";
import { formatRelativeDate, type Note } from "./fixtures";
import { useUpdateNote } from "./hooks";
import type { SupernoteEditorProps } from "@supernote/editor";

// Dynamic import to avoid SSR issues — BlockNote uses browser-only APIs
const SupernoteEditor = dynamic<SupernoteEditorProps>(
  () => import("@supernote/editor").then((m) => ({ default: m.SupernoteEditor })),
  { ssr: false, loading: () => <EditorSkeleton /> },
);

interface NoteEditorProps {
  note: Note;
}

type SaveStatus = "idle" | "saving" | "saved" | "error";

const DEBOUNCE_MS = 1000;

export function NoteEditor({ note }: NoteEditorProps) {
  const [title, setTitle] = useState(note.title);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bodyRef = useRef<string>(note.body);

  const { updateNote } = useUpdateNote();

  const triggerAutoSave = useCallback(
    (markdown: string, updatedTitle: string) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      setSaveStatus("saving");
      debounceRef.current = setTimeout(async () => {
        try {
          await updateNote(note.id, updatedTitle, markdown);
          setSaveStatus("saved");
          setTimeout(() => setSaveStatus("idle"), 2000);
        } catch {
          setSaveStatus("error");
          setTimeout(() => setSaveStatus("idle"), 3000);
        }
      }, DEBOUNCE_MS);
    },
    [note.id, updateNote],
  );

  const handleEditorChange = useCallback(
    (markdown: string) => {
      bodyRef.current = markdown;
      triggerAutoSave(markdown, title);
    },
    [triggerAutoSave, title],
  );

  const handleTitleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const next = e.target.value;
      setTitle(next);
      triggerAutoSave(bodyRef.current, next);
    },
    [triggerAutoSave],
  );

  const handleManualSave = useCallback(
    async (md: string) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      setSaveStatus("saving");
      try {
        await updateNote(note.id, title, md);
        setSaveStatus("saved");
        setTimeout(() => setSaveStatus("idle"), 2000);
      } catch {
        setSaveStatus("error");
        setTimeout(() => setSaveStatus("idle"), 3000);
      }
    },
    [note.id, title, updateNote],
  );

  const date = new Date(note.updatedAt).toLocaleDateString("fr-FR", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="px-10 py-6" style={{ borderBottom: "1px solid var(--border-subtle)" }}>
        <input
          type="text"
          value={title}
          onChange={handleTitleChange}
          className="w-full bg-transparent text-2xl font-bold leading-tight outline-none"
          style={{ color: "var(--text-primary)" }}
          placeholder="Sans titre"
          aria-label="Titre de la note"
        />

        <div className="mt-3 flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-1.5">
            <Calendar size={13} style={{ color: "var(--text-muted)" }} />
            <span className="text-xs" style={{ color: "var(--text-muted)" }}>
              {date}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <Hash size={13} style={{ color: "var(--text-muted)" }} />
            <span className="text-xs capitalize" style={{ color: "var(--text-muted)" }}>
              {note.folderPath}
            </span>
          </div>
          {note.tags.length > 0 && (
            <div className="flex items-center gap-1.5">
              <Tag size={13} style={{ color: "var(--text-muted)" }} />
              <div className="flex flex-wrap gap-1">
                {note.tags.map((tag) => (
                  <span
                    key={tag}
                    className="rounded px-1.5 py-0.5 text-[10px] font-medium"
                    style={{ backgroundColor: "var(--accent-subtle)", color: "var(--accent)" }}
                  >
                    #{tag}
                  </span>
                ))}
              </div>
            </div>
          )}
          <SaveIndicator status={saveStatus} />
        </div>
      </div>

      {/* Editor area */}
      <div className="flex-1 overflow-y-auto px-10 py-6">
        <SupernoteEditor
          initialMarkdown={note.body}
          onChange={handleEditorChange}
          onSave={handleManualSave}
          className="min-h-[60vh] w-full"
        />
      </div>

      {/* Footer */}
      <div
        className="flex items-center justify-between px-10 py-3"
        style={{ borderTop: "1px solid var(--border-subtle)" }}
      >
        <span className="text-xs" style={{ color: "var(--text-muted)" }}>
          Modifié {formatRelativeDate(note.updatedAt).toLowerCase()}
        </span>
      </div>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

interface SaveIndicatorProps {
  status: SaveStatus;
}

function SaveIndicator({ status }: SaveIndicatorProps) {
  if (status === "idle") return null;
  const label =
    status === "saving" ? "Sauvegarde…" : status === "saved" ? "Sauvegardé" : "Erreur";
  const color = status === "error" ? "var(--color-red-500, #ef4444)" : "var(--text-muted)";
  return (
    <div className="flex items-center gap-1" style={{ color }}>
      <FloppyDisk size={11} />
      <span className="text-[10px]">{label}</span>
    </div>
  );
}

function EditorSkeleton() {
  return (
    <div className="animate-pulse space-y-3 pt-2">
      {[100, 80, 90, 60].map((w, i) => (
        <div
          key={i}
          className="h-4 rounded"
          style={{ width: `${w}%`, backgroundColor: "var(--surface-2)" }}
        />
      ))}
    </div>
  );
}
