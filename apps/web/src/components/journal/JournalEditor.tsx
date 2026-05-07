"use client";

import { useCallback, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { FloppyDisk } from "@phosphor-icons/react";
import type { SupernoteEditorProps } from "@supernote/editor";

const SupernoteEditor = dynamic<SupernoteEditorProps>(
  () => import("@supernote/editor").then((m) => ({ default: m.SupernoteEditor })),
  { ssr: false, loading: () => <EditorSkeleton /> },
);

interface JournalEditorProps {
  date: string; // "YYYY-MM-DD"
  initialMarkdown: string;
}

type SaveStatus = "idle" | "saving" | "saved";

export function JournalEditor({ date, initialMarkdown }: JournalEditorProps) {
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleChange = useCallback((markdown: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setSaveStatus("saving");
    debounceRef.current = setTimeout(() => {
      // Placeholder: tRPC mutation will replace this
      console.log("[journal-autosave]", { date, bodyLength: markdown.length });
      setSaveStatus("saved");
      setTimeout(() => setSaveStatus("idle"), 2000);
    }, 1000);
  }, [date]);

  const handleSave = useCallback((md: string) => {
    console.log("[journal-manual-save]", { date, bodyLength: md.length });
    setSaveStatus("saved");
    setTimeout(() => setSaveStatus("idle"), 2000);
  }, [date]);

  const displayDate = new Date(date + "T12:00:00").toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="px-10 py-6" style={{ borderBottom: "1px solid var(--border-subtle)" }}>
        <h1 className="text-2xl font-bold capitalize" style={{ color: "var(--text-primary)" }}>
          {displayDate}
        </h1>
        {saveStatus !== "idle" && (
          <div className="mt-2 flex items-center gap-1" style={{ color: "var(--text-muted)" }}>
            <FloppyDisk size={11} />
            <span className="text-[10px]">
              {saveStatus === "saving" ? "Sauvegarde…" : "Sauvegardé"}
            </span>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-10 py-6">
        <SupernoteEditor
          key={date}
          initialMarkdown={initialMarkdown}
          onChange={handleChange}
          onSave={handleSave}
          className="min-h-[60vh] w-full"
        />
      </div>
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
