"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { FloppyDisk, WarningCircle } from "@phosphor-icons/react";
import type { SupernoteEditorProps } from "@supernote/editor";
import { useDailyEntity } from "@/hooks/useDailyEntity";

const SupernoteEditor = dynamic<SupernoteEditorProps>(
  () => import("@supernote/editor").then((m) => ({ default: m.SupernoteEditor })),
  { ssr: false, loading: () => <EditorSkeleton /> },
);

interface JournalEditorProps {
  date: string; // "YYYY-MM-DD"
}

type SaveStatus = "idle" | "saving" | "saved" | "error";

export function JournalEditor({ date }: JournalEditorProps) {
  const { initialMarkdown, isLoading, persist } = useDailyEntity(date);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const runPersist = useCallback(
    async (markdown: string) => {
      try {
        await persist(markdown);
        setSaveStatus("saved");
        setTimeout(() => setSaveStatus("idle"), 2000);
      } catch (err) {
        console.error("[journal] échec de la sauvegarde", err);
        // Contrairement à "saved", pas d'auto-retour à "idle" : un échec ne
        // doit pas disparaître silencieusement pendant que l'utilisateur
        // regarde ailleurs. Reste affiché jusqu'à la prochaine tentative.
        setSaveStatus("error");
      }
    },
    [persist],
  );

  const handleChange = useCallback(
    (markdown: string) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      setSaveStatus("saving");
      debounceRef.current = setTimeout(() => {
        void runPersist(markdown);
      }, 1000);
    },
    [runPersist],
  );

  const handleSave = useCallback(
    (markdown: string) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      setSaveStatus("saving");
      void runPersist(markdown);
    },
    [runPersist],
  );

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const displayDate = new Date(date + "T12:00:00").toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  if (isLoading) {
    return (
      <div className="flex h-full flex-col overflow-hidden px-10 py-6">
        <EditorSkeleton />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="px-10 py-6" style={{ borderBottom: "1px solid var(--border-subtle)" }}>
        <h1 className="text-2xl font-bold capitalize" style={{ color: "var(--text-primary)" }}>
          {displayDate}
        </h1>
        {saveStatus !== "idle" && (
          <div
            className="mt-2 flex items-center gap-1"
            style={{ color: saveStatus === "error" ? "var(--danger)" : "var(--text-muted)" }}
          >
            {saveStatus === "error" ? (
              <WarningCircle size={11} weight="bold" />
            ) : (
              <FloppyDisk size={11} />
            )}
            <span className="text-[10px]">
              {saveStatus === "saving"
                ? "Sauvegarde…"
                : saveStatus === "error"
                  ? "Échec de la sauvegarde"
                  : "Sauvegardé"}
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
