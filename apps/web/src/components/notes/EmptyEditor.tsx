"use client";

import { FileText, Plus } from "lucide-react";

interface EmptyEditorProps {
  onNewNote: () => void;
}

export function EmptyEditor({ onNewNote }: EmptyEditorProps) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-6 p-8 text-center">
      <div
        className="flex h-16 w-16 items-center justify-center rounded-2xl"
        style={{ backgroundColor: "var(--accent-subtle)" }}
      >
        <FileText size={28} style={{ color: "var(--accent)" }} />
      </div>

      <div className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold" style={{ color: "var(--text-primary)" }}>
          Sélectionnez une note ou créez-en une
        </h2>
        <p
          className="max-w-xs text-sm leading-relaxed"
          style={{ color: "var(--text-muted)" }}
        >
          Choisissez une note dans la liste, ou créez-en une nouvelle dans le dossier sélectionné.
        </p>
      </div>

      <button
        onClick={onNewNote}
        className="flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-medium transition-opacity hover:opacity-90"
        style={{
          backgroundColor: "var(--accent)",
          color: "var(--accent-foreground)",
        }}
      >
        <Plus size={15} />
        Nouvelle note
      </button>
    </div>
  );
}
