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

/** Debounce en attente pour UNE date — voir le commentaire sur `dateRef`. */
interface PendingDebounce {
  date: string;
  markdown: string;
  timer: ReturnType<typeof setTimeout>;
}

/** Flush à rejouer par l'effect suivant le rendu qui l'a détecté. */
interface PendingFlush {
  date: string;
  markdown: string;
  persist: (markdown: string) => Promise<void>;
}

export function JournalEditor({ date }: JournalEditorProps) {
  const { initialMarkdown, isLoading, persist } = useDailyEntity(date);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");

  // `<JournalEditor>` n'est jamais remonté au changement de date (seul
  // `<SupernoteEditor key={date}>` l'est) — ces refs doivent donc porter
  // explicitement leur date pour ne jamais agir sur la mauvaise entrée.
  const debounceRef = useRef<PendingDebounce | null>(null);
  const dateRef = useRef(date);
  const persistRef = useRef(persist);
  const pendingFlushRef = useRef<PendingFlush | null>(null);

  const runPersist = useCallback(
    async (forDate: string, markdown: string, doPersist: (markdown: string) => Promise<void>) => {
      try {
        await doPersist(markdown);
        // Un résultat pour une date qu'on ne regarde plus ne doit pas se
        // faire passer pour le statut de sauvegarde de la date affichée.
        if (forDate === dateRef.current) {
          setSaveStatus("saved");
          setTimeout(() => setSaveStatus("idle"), 2000);
        }
      } catch (err) {
        console.error("[journal] échec de la sauvegarde", err);
        // Contrairement à "saved", pas d'auto-retour à "idle" : un échec ne
        // doit pas disparaître silencieusement pendant que l'utilisateur
        // regarde ailleurs. Reste affiché jusqu'à la prochaine tentative.
        if (forDate === dateRef.current) setSaveStatus("error");
      }
    },
    [],
  );

  // Détecté PENDANT le rendu — avant que l'enfant SupernoteEditor (qui,
  // lui, remonte via key={date}) ne puisse déclencher son propre onChange
  // dès le montage (ensureTrailingParagraph dans @supernote/editor) et
  // écraser silencieusement le debounce de la date qu'on quitte. Un flush
  // réel (appel réseau) n'est pas un effet de bord de rendu admissible —
  // on le stocke, l'effect ci-dessous le joue juste après le commit.
  if (dateRef.current !== date) {
    const pending = debounceRef.current;
    if (pending) {
      clearTimeout(pending.timer);
      pendingFlushRef.current = { date: pending.date, markdown: pending.markdown, persist: persistRef.current };
      debounceRef.current = null;
    }
    dateRef.current = date;
  }
  persistRef.current = persist;

  useEffect(() => {
    const toFlush = pendingFlushRef.current;
    if (!toFlush) return;
    pendingFlushRef.current = null;
    void runPersist(toFlush.date, toFlush.markdown, toFlush.persist);
  }, [date, runPersist]);

  const handleChange = useCallback(
    (markdown: string) => {
      // Un debounce en attente pour CETTE date est remplacé (dernier gagne,
      // coalescence normale) — un debounce d'une AUTRE date n'atterrit
      // jamais ici : le rendu ci-dessus l'a déjà détaché et mis en flush.
      if (debounceRef.current && debounceRef.current.date === date) {
        clearTimeout(debounceRef.current.timer);
      }
      setSaveStatus("saving");
      const timer = setTimeout(() => {
        debounceRef.current = null;
        void runPersist(date, markdown, persist);
      }, 1000);
      debounceRef.current = { date, markdown, timer };
    },
    [date, persist, runPersist],
  );

  const handleSave = useCallback(
    (markdown: string) => {
      if (debounceRef.current && debounceRef.current.date === date) {
        clearTimeout(debounceRef.current.timer);
      }
      debounceRef.current = null;
      setSaveStatus("saving");
      void runPersist(date, markdown, persist);
    },
    [date, persist, runPersist],
  );

  // Démontage réel de JournalEditor (navigation hors de /journal), distinct
  // du changement de date déjà géré ci-dessus : flush le debounce en
  // attente au lieu de le laisser mourir avec son timer.
  useEffect(() => {
    return () => {
      const pending = debounceRef.current;
      if (!pending) return;
      clearTimeout(pending.timer);
      debounceRef.current = null;
      void runPersist(pending.date, pending.markdown, persistRef.current);
    };
  }, [runPersist]);

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
