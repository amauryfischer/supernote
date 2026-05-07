"use client";

import { Calendar, Hash, Tag } from "lucide-react";
import { formatRelativeDate, type Note } from "./fixtures";

interface NoteEditorProps {
  note: Note;
}

export function NoteEditor({ note }: NoteEditorProps) {
  const date = new Date(note.updatedAt).toLocaleDateString("fr-FR", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Note header */}
      <div
        className="px-10 py-6"
        style={{ borderBottom: "1px solid var(--border-subtle)" }}
      >
        <h1
          className="text-2xl font-bold leading-tight"
          style={{ color: "var(--text-primary)" }}
        >
          {note.title}
        </h1>

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
                    style={{
                      backgroundColor: "var(--accent-subtle)",
                      color: "var(--accent)",
                    }}
                  >
                    #{tag}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Note body */}
      <div className="flex-1 overflow-y-auto px-10 py-6">
        <p
          className="whitespace-pre-wrap text-sm leading-8"
          style={{ color: "var(--text-secondary)", maxWidth: 680 }}
        >
          {note.body}
        </p>

        {/* Editor placeholder */}
        <div
          className="mt-8 rounded-xl p-6 text-center text-sm"
          style={{
            backgroundColor: "var(--surface-1)",
            border: "1px dashed var(--border)",
            color: "var(--text-muted)",
          }}
        >
          L'éditeur block-based (BlockNote) sera intégré ici par l'agent packages/editor.
        </div>
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
