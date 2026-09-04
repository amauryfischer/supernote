"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { FloppyDisk, WarningCircle } from "@phosphor-icons/react";
import type { SupernoteEditorProps } from "@supernote/editor";
import { useToast } from "@supernote/ui";
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

function formatDisplayDate(date: string): string {
  return new Date(date + "T12:00:00").toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export function JournalEditor({ date }: JournalEditorProps) {
  const { initialMarkdown, isLoading, persist } = useDailyEntity(date);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const { toast } = useToast();

  // `<JournalEditor>` n'est jamais remonté au changement de date (seul
  // `<SupernoteEditor key={date}>` l'est) — ces refs doivent donc porter
  // explicitement leur date pour ne jamais agir sur la mauvaise entrée.
  const debounceRef = useRef<PendingDebounce | null>(null);
  const dateRef = useRef(date);
  const persistRef = useRef(persist);
  const pendingFlushRef = useRef<PendingFlush | null>(null);
  // Compteur monotone : incrémenté à CHAQUE dispatch réel d'un persist
  // (debounce qui tire, Ctrl+S, flush). Un résultat dont le seq capturé ne
  // correspond plus à seqRef.current a été dépassé par un envoi plus
  // récent — même à date constante, y compris pendant que l'ancien est
  // encore en vol réseau (contrairement à debounceRef, qui ne dit rien
  // pendant ce vol).
  const seqRef = useRef(0);
  // Passe à false dans le cleanup de démontage, AVANT le flush — sinon un
  // flush au démontage qui échoue prend la branche "même date" (le
  // composant démonté n'a pas changé dateRef) et échoue en silence.
  const isMountedRef = useRef(true);

  const runPersist = useCallback(
    async (
      forDate: string,
      seq: number,
      markdown: string,
      doPersist: (markdown: string) => Promise<void>,
    ) => {
      try {
        await doPersist(markdown);
        // Un résultat pour une date qu'on ne regarde plus ne doit pas se
        // faire passer pour le statut de sauvegarde de la date affichée — et
        // même à date constante, un envoi plus récent déjà dispatché (frappe
        // pendant que CE persist attendait le réseau) signifie qu'un contenu
        // plus frais n'est pas encore sauvegardé : ne pas afficher "Sauvegardé"
        // pour lui à sa place.
        if (forDate === dateRef.current && seq === seqRef.current) {
          setSaveStatus("saved");
          setTimeout(() => setSaveStatus("idle"), 2000);
        }
      } catch (err) {
        console.error("[journal] échec de la sauvegarde", err);
        if (!isMountedRef.current || forDate !== dateRef.current) {
          // Composant démonté, ou date affichée changée depuis ce persist
          // (flush au changement de date / au démontage, ou navigation
          // pendant un envoi encore en vol) : aucun badge ne peut plus
          // représenter cet échec, et le markdown n'existe plus nulle part
          // ailleurs — irrécupérable sans ce signal.
          toast({
            title: "Sauvegarde échouée",
            description: `L'entrée du ${formatDisplayDate(forDate)} n'a pas été enregistrée.`,
            variant: "danger",
            duration: 0,
          });
        } else if (seq === seqRef.current) {
          // Contrairement à "saved", pas d'auto-retour à "idle" : un échec ne
          // doit pas disparaître silencieusement pendant que l'utilisateur
          // regarde ailleurs. Reste affiché jusqu'à la prochaine tentative.
          // Un envoi plus récent déjà dispatché rejouera le contenu complet —
          // rien d'irrécupérable dans ce cas, pas la peine d'alerter.
          setSaveStatus("error");
        }
      }
    },
    [toast],
  );

  // Détecté PENDANT le rendu — avant que l'enfant SupernoteEditor (qui,
  // lui, remonte via key={date}) ne puisse déclencher son propre onChange
  // dès le montage (ensureTrailingParagraph dans @supernote/editor) et
  // écraser silencieusement le debounce de la date qu'on quitte. Un flush
  // réel (appel réseau) n'est pas un effet de bord de rendu admissible —
  // on le stocke, l'effect ci-dessous le joue juste après le commit.
  if (dateRef.current !== date) {
    // Réinitialisé ICI (pendant le rendu) et non dans l'effect plus bas :
    // les effets passifs de l'enfant (qui, lui, remonte via key={date})
    // tournent avant ceux du parent — si on attendait l'effect, un
    // ensureTrailingParagraph déclenchant handleChange au montage de
    // l'enfant se ferait immédiatement effacer par ce reset. Fait pendant
    // le rendu, le reset précède TOUT effet (enfant compris), donc un
    // éventuel "saving" posé par l'enfant juste après survit normalement.
    // Ferme aussi bien le "Sauvegarde…" résiduel que l'"error" qui, lui,
    // ne s'efface jamais tout seul (cf. runPersist).
    setSaveStatus("idle");
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
    const seq = ++seqRef.current;
    void runPersist(toFlush.date, seq, toFlush.markdown, toFlush.persist);
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
        const seq = ++seqRef.current;
        void runPersist(date, seq, markdown, persist);
      }, 1000);
      debounceRef.current = { date, markdown, timer };
    },
    [date, persist, runPersist],
  );

  const handleSave = useCallback(
    (markdown: string) => {
      // Symétrique à handleChange : un debounce d'une AUTRE date (en
      // théorie inatteignable, le rendu l'a déjà détaché) ne doit jamais
      // être vidé sans être flushé.
      if (debounceRef.current && debounceRef.current.date === date) {
        clearTimeout(debounceRef.current.timer);
        debounceRef.current = null;
      }
      setSaveStatus("saving");
      const seq = ++seqRef.current;
      void runPersist(date, seq, markdown, persist);
    },
    [date, persist, runPersist],
  );

  // Démontage réel de JournalEditor (navigation hors de /journal), distinct
  // du changement de date déjà géré ci-dessus : flush le debounce en
  // attente au lieu de le laisser mourir avec son timer.
  useEffect(() => {
    return () => {
      isMountedRef.current = false;
      const pending = debounceRef.current;
      if (!pending) return;
      clearTimeout(pending.timer);
      debounceRef.current = null;
      const seq = ++seqRef.current;
      void runPersist(pending.date, seq, pending.markdown, persistRef.current);
    };
  }, [runPersist]);

  const displayDate = formatDisplayDate(date);

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
