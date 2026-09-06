"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { FloppyDisk, WarningCircle } from "@phosphor-icons/react";
import type { SupernoteEditorProps } from "@supernote/editor";
import type { MentionMatch } from "@supernote/ai";
import { useToast } from "@supernote/ui";
import { useDailyEntity } from "@/hooks/useDailyEntity";
import { registerLiveJournalEntry } from "@/lib/journal-live-entry";
import {
  useJournalExtraction,
  type ActionSuggestion,
  type JournalSuggestion,
  type MentionSuggestion,
} from "@/hooks/useJournalExtraction";
import { ExtractionSuggestions } from "./ExtractionSuggestions";

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

/**
 * Contenu poussé programmatiquement après acceptation d'une mention. Remonte
 * `<SupernoteEditor>` via `rev` : `SupernoteEditorApi` n'expose qu'une
 * insertion au caret, aucun remplacement à offset — la seule voie est de
 * réécrire le markdown et de recréer le document (le DOM ProseMirror ne doit
 * jamais être muté de l'extérieur).
 */
interface EditorOverride {
  date: string;
  markdown: string;
  rev: number;
}

/**
 * Identité par CONTENU d'une suggestion. Les clés du hook portent un offset ou
 * un index de tableau : elles changent à chaque passe, alors qu'une suggestion
 * écartée doit le rester tant que le texte dit la même chose.
 */
function suggestionContentKey(s: JournalSuggestion): string {
  return s.kind === "mention"
    ? `m:${s.match.entityId}:${s.match.matchedText.toLowerCase()}`
    : `a:${s.action.text.trim().toLowerCase()}`;
}

/** L'extracteur re-matche un nom déjà lié : sans ça la chip revient à chaque passe. */
function isInsideWikilink(text: string, start: number, end: number): boolean {
  const open = text.lastIndexOf("[[", start);
  if (open === -1) return false;
  if (text.lastIndexOf("]]", start) > open) return false;
  const close = text.indexOf("]]", end);
  if (close === -1) return false;
  // Un `[[` avant ce `]]` : la fermeture appartient à un lien qui commence
  // APRÈS nous, donc le `[[` d'avant n'était jamais fermé et on est dehors.
  const nextOpen = text.indexOf("[[", end);
  return nextOpen === -1 || nextOpen > close;
}

/** Un `[[Nom]]` écrit dans du code y resterait littéral et corromprait l'échantillon. */
function isInsideCode(text: string, start: number): boolean {
  const before = text.slice(0, start);
  const fences = before.match(/^[ \t]*```/gm);
  if (fences && fences.length % 2 === 1) return true;
  const lineStart = before.lastIndexOf("\n") + 1;
  return (before.slice(lineStart).split("`").length - 1) % 2 === 1;
}

/** Positions où `[[…]]` peut réellement remplacer `needle` sans rien casser. */
function writableOccurrences(base: string, needle: string): number[] {
  const out: number[] = [];
  for (let at = base.indexOf(needle); at !== -1; at = base.indexOf(needle, at + 1)) {
    if (isInsideWikilink(base, at, at + needle.length)) continue;
    if (isInsideCode(base, at)) continue;
    out.push(at);
  }
  return out;
}

/**
 * Où réécrire, dans `base`, la mention proposée — ou `null` si c'est
 * indécidable. Les offsets d'une MentionMatch ne sont JAMAIS fiables : pour une
 * source `ollama` ce sont des entiers rendus par le modèle, validés seulement
 * comme entiers positifs ; et le texte a pu bouger pendant la passe. On
 * n'écrit donc que là où `matchedText` se trouve littéralement.
 *
 * Les occurrences déjà liées sont retirées AVANT d'arbitrer : sinon, un contact
 * cité deux fois n'est liable qu'une seule fois par journée — la seconde
 * occurrence perd toujours contre la première, que `oneMentionPerEntity` a
 * choisie et que le wikilink vient de neutraliser.
 */
function resolveMentionSpan(base: string, match: MentionMatch): [number, number] | null {
  if (!match.matchedText) return null;
  const len = match.matchedText.length;
  const free = writableOccurrences(base, match.matchedText);
  if (free.length === 0) return null;
  if (
    base.slice(match.startOffset, match.endOffset) === match.matchedText &&
    free.includes(match.startOffset)
  ) {
    return [match.startOffset, match.endOffset];
  }
  // Une seule occurrence libre : c'est forcément celle-là. Plusieurs, avec des
  // offsets qui ne correspondent plus — rien ne dit laquelle le modèle visait.
  if (free.length > 1) return null;
  return [free[0]!, free[0]! + len];
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
  const { entityId, initialMarkdown, isLoading, isReady, persist } = useDailyEntity(date);
  const {
    suggestions,
    truncated,
    trigger: triggerExtraction,
    dismissMention,
    acceptAction,
  } = useJournalExtraction(date);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [override, setOverride] = useState<EditorOverride | null>(null);
  const { toast } = useToast();

  // `<JournalEditor>` n'est jamais remonté au changement de date (seul
  // `<SupernoteEditor key={date}>` l'est) — ces refs doivent donc porter
  // explicitement leur date pour ne jamais agir sur la mauvaise entrée.
  const debounceRef = useRef<PendingDebounce | null>(null);
  const dateRef = useRef(date);
  const persistRef = useRef(persist);
  const pendingFlushRef = useRef<PendingFlush | null>(null);
  // Dernier markdown effectivement soumis à l'extraction : les offsets d'une
  // MentionMatch sont calculés contre CE texte. Tagué par date pour la même
  // raison que debounceRef.
  const lastExtractedRef = useRef<{ date: string; markdown: string } | null>(null);
  // Dernier markdown connu de l'éditeur. Plus frais qu'`initialMarkdown`, qui
  // ne bouge qu'au retour d'un persist (patch du cache React Query) : entre la
  // frappe et ce retour, lui seul décrit ce que l'utilisateur voit. Base
  // obligatoire de la capture rapide, sous peine de la faire écrire par-dessus
  // du texte déjà tapé.
  const liveMarkdownRef = useRef<{ date: string; markdown: string } | null>(null);
  // Suggestions écartées (ignorées, ou action déjà transformée en tâche) : le
  // texte n'ayant pas changé, la passe suivante les reproposerait en boucle.
  const suppressedRef = useRef<{ date: string; keys: Set<string> }>({ date, keys: new Set() });
  // Compteur monotone : incrémenté à CHAQUE dispatch réel d'un persist
  // (debounce qui tire, Ctrl+S, flush). Un résultat dont le seq capturé ne
  // correspond plus à seqRef.current a été dépassé par un envoi plus
  // récent — même à date constante, y compris pendant que l'ancien est
  // encore en vol réseau (contrairement à debounceRef, qui ne dit rien
  // pendant ce vol).
  const seqRef = useRef(0);
  // Capture reçue avant que la liste n'ait répondu : l'entité du jour n'est pas
  // encore identifiée, écrire maintenant en créerait une seconde pour la même
  // date. Tamponnée ici plutôt que refusée — l'éditeur s'inscrit au registre
  // dès son montage, donc il n'existe aucune fenêtre où personne n'écrit, et
  // la capture ne peut plus être écrite en parallèle par l'overlay.
  const bufferedCaptureRef = useRef<{ date: string; text: string } | null>(null);
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
    // Un override survivant à la date qu'on quitte serait re-servi tel quel au
    // retour sur cette date (clé inchangée → remontage) et écraserait tout ce
    // qui a été tapé après l'acceptation. `initialMarkdown` redevient la
    // source de vérité.
    setOverride(null);
    suppressedRef.current = { date, keys: new Set() };
    liveMarkdownRef.current = null;
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

  // Point de passage unique vers l'extraction. Le dédoublonnage n'est pas une
  // optimisation : à l'ouverture, la passe de chargement et le `onChange` que
  // BlockNote émet au montage (ensureTrailingParagraph) soumettent le même
  // texte à une seconde d'intervalle, pour deux appels au modèle.
  const submitExtraction = useCallback(
    (forDate: string, markdown: string) => {
      const last = lastExtractedRef.current;
      if (last?.date === forDate && last.markdown === markdown) return;
      lastExtractedRef.current = { date: forDate, markdown };
      triggerExtraction(markdown);
    },
    [triggerExtraction],
  );

  // Le journal est la page d'accueil : on l'ouvre bien plus souvent qu'on n'y
  // tape. Sans passe au chargement, une journée déjà rédigée — la veille, ou
  // sur mobile où l'IA ne tourne pas — n'a jamais la moindre suggestion.
  // `entityId` plutôt que le markdown : le gabarit d'une journée vierge est du
  // texte, mais rien n'y a été écrit.
  useEffect(() => {
    if (isLoading || !entityId) return;
    if (lastExtractedRef.current?.date === date) return;
    if (!initialMarkdown.trim()) return;
    submitExtraction(date, initialMarkdown);
  }, [date, entityId, initialMarkdown, isLoading, submitExtraction]);

  const handleChange = useCallback(
    (markdown: string) => {
      // Un debounce en attente pour CETTE date est remplacé (dernier gagne,
      // coalescence normale) — un debounce d'une AUTRE date n'atterrit
      // jamais ici : le rendu ci-dessus l'a déjà détaché et mis en flush.
      if (debounceRef.current && debounceRef.current.date === date) {
        clearTimeout(debounceRef.current.timer);
      }
      liveMarkdownRef.current = { date, markdown };
      setSaveStatus("saving");
      const timer = setTimeout(() => {
        debounceRef.current = null;
        const seq = ++seqRef.current;
        void runPersist(date, seq, markdown, persist);
        submitExtraction(date, markdown);
      }, 1000);
      debounceRef.current = { date, markdown, timer };
    },
    [date, persist, runPersist, submitExtraction],
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
      liveMarkdownRef.current = { date, markdown };
      setSaveStatus("saving");
      const seq = ++seqRef.current;
      void runPersist(date, seq, markdown, persist);
      submitExtraction(date, markdown);
    },
    [date, persist, runPersist, submitExtraction],
  );

  // Une mention acceptée réécrit le markdown puis le persiste — jamais une
  // mutation du DOM de l'éditeur. Rien n'est appliqué sans ce clic.
  const handleAcceptMention = useCallback(
    (suggestion: MentionSuggestion) => {
      const { match } = suggestion;
      // Un debounce en attente porte un texte PLUS FRAIS que la dernière passe
      // d'extraction : réécrire sur la base périmée perdrait la frappe en vol.
      const pending = debounceRef.current?.date === date ? debounceRef.current : null;
      const lastExtracted =
        lastExtractedRef.current?.date === date ? lastExtractedRef.current : null;
      // `base === null` couvre aussi une chip d'une AUTRE date restée à l'écran :
      // aucune réécriture ne peut alors être rattachée au texte affiché.
      const base = pending?.markdown ?? lastExtracted?.markdown ?? null;
      const span = base === null ? null : resolveMentionSpan(base, match);
      if (base === null || span === null) {
        // Ne PAS suppresser : la position est indécidable maintenant, pas la
        // mention. Un abandon muet donnerait une chip qui revient et un clic
        // sans effet, en boucle — le toast dit que la suite est de réessayer.
        dismissMention(suggestion.key);
        toast({
          title: "Mention non appliquée",
          description:
            `« ${match.matchedText} » n'est plus à la position analysée. ` +
            "La suggestion reviendra à la prochaine passe.",
          variant: "warning",
        });
        return;
      }
      const rewritten = base.slice(0, span[0]) + `[[${match.entityName}]]` + base.slice(span[1]);

      if (pending) {
        // Ce persist-ci porte le même texte, mention comprise : le debounce
        // en attente n'a plus qu'un contenu périmé à écrire.
        clearTimeout(pending.timer);
        debounceRef.current = null;
      }
      liveMarkdownRef.current = { date, markdown: rewritten };
      setOverride((prev) => ({ date, markdown: rewritten, rev: (prev?.rev ?? 0) + 1 }));
      setSaveStatus("saving");
      const seq = ++seqRef.current;
      void runPersist(date, seq, rewritten, persist);
      dismissMention(suggestion.key);
      // Relancer sur le texte réécrit : une seconde occurrence du même contact
      // ne devient proposable qu'une fois la première neutralisée.
      submitExtraction(date, rewritten);
    },
    [date, dismissMention, persist, runPersist, submitExtraction, toast],
  );

  const handleAcceptAction = useCallback(
    (suggestion: ActionSuggestion) => {
      const forDate = date;
      void acceptAction(suggestion).then((created) => {
        // Écarter avant l'issue perdrait définitivement une action que le clic
        // a bien demandée mais que le worker a refusée : la chip est déjà
        // retirée, seule une passe ultérieure peut la reproposer.
        if (!created || suppressedRef.current.date !== forDate) return;
        suppressedRef.current.keys.add(suggestionContentKey(suggestion));
      });
    },
    [acceptAction, date],
  );

  const handleReject = useCallback(
    (key: string) => {
      const target = suggestions.find((s) => s.key === key);
      if (target) suppressedRef.current.keys.add(suggestionContentKey(target));
      dismissMention(key);
    },
    [dismissMention, suggestions],
  );

  // Capture rapide : le texte vient de l'overlay, pas de l'éditeur. Même
  // mécanique qu'une mention acceptée — réécriture du markdown puis remontage
  // via `override`, jamais de mutation du DOM ProseMirror.
  const appendCapture = useCallback(
    (text: string) => {
      if (!isReady) {
        const buffered =
          bufferedCaptureRef.current?.date === date ? bufferedCaptureRef.current.text : null;
        bufferedCaptureRef.current = { date, text: buffered ? `${buffered}\n\n${text}` : text };
        return;
      }
      const live = liveMarkdownRef.current?.date === date ? liveMarkdownRef.current.markdown : null;
      const base = (live ?? initialMarkdown).trimEnd();
      const next = base.length > 0 ? `${base}\n\n${text}` : text;
      const pending = debounceRef.current?.date === date ? debounceRef.current : null;
      if (pending) {
        // Son markdown est celui d'AVANT la capture : le laisser tirer
        // réécrirait l'entrée sans elle.
        clearTimeout(pending.timer);
        debounceRef.current = null;
      }
      liveMarkdownRef.current = { date, markdown: next };
      setOverride((prev) => ({ date, markdown: next, rev: (prev?.rev ?? 0) + 1 }));
      setSaveStatus("saving");
      const seq = ++seqRef.current;
      void runPersist(date, seq, next, persist);
      submitExtraction(date, next);
    },
    [date, initialMarkdown, isReady, persist, runPersist, submitExtraction],
  );

  // Le registre ne veut qu'une fonction stable : `appendCapture` change à
  // chaque rendu (dep `persist`), et se réinscrire à chaque rendu déferait
  // l'inscription sous la capture qui la lit.
  const appendCaptureRef = useRef(appendCapture);
  appendCaptureRef.current = appendCapture;

  // Tant que cet éditeur est monté, il est le seul écrivain de sa date : la
  // capture rapide lui remet son texte au lieu d'écrire en parallèle sur la
  // même entité. Inscription dès le montage, chargement non attendu : une
  // inscription différée laisserait une fenêtre où l'overlay se croit seul et
  // écrirait un corps que le document monté juste après ne contient pas.
  useEffect(() => {
    return registerLiveJournalEntry(date, (text) => appendCaptureRef.current(text));
  }, [date]);

  // Rejeu du tampon dès que la liste a répondu. Un tampon d'une autre date est
  // laissé en place : il sera écrit au retour sur cette date, plutôt que perdu.
  useEffect(() => {
    if (!isReady) return;
    const buffered = bufferedCaptureRef.current;
    if (!buffered || buffered.date !== date) return;
    bufferedCaptureRef.current = null;
    appendCaptureRef.current(buffered.text);
  }, [date, isReady]);

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
  // Le reset au changement de date est un setState de rendu : `override` porte
  // encore la date précédente le temps d'un rendu non commité.
  const activeOverride = override?.date === date ? override : null;
  // `lastExtractedRef` est écrit juste avant chaque `triggerExtraction` : il
  // porte donc bien le texte contre lequel `suggestions` a été calculé.
  const visibleSuggestions = useMemo(() => {
    const suppressed = suppressedRef.current;
    const base = lastExtractedRef.current?.date === date ? lastExtractedRef.current.markdown : null;
    // Aucune passe soumise pour cette date : ces chips — actions comprises —
    // appartiennent à la veille. La purge du hook est un effet passif, donc
    // post-commit : sans ce court-circuit, une frame les affiche au-dessus du
    // texte du jour.
    if (base === null) return [];
    return suggestions.filter((s) => {
      if (suppressed.date === date && suppressed.keys.has(suggestionContentKey(s))) return false;
      if (s.kind !== "mention") return true;
      // Même règle qu'à l'acceptation : ne pas proposer ce qu'on refuserait
      // d'écrire — occurrences déjà liées ou dans du code exclues, position
      // indécidable exclue.
      return resolveMentionSpan(base, s.match) !== null;
    });
  }, [suggestions, date]);

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
          key={`${date}#${activeOverride?.rev ?? 0}`}
          initialMarkdown={activeOverride?.markdown ?? initialMarkdown}
          onChange={handleChange}
          onSave={handleSave}
          className="min-h-[60vh] w-full"
        />
      </div>

      <ExtractionSuggestions
        suggestions={visibleSuggestions}
        truncated={truncated}
        onAcceptMention={handleAcceptMention}
        onAcceptAction={handleAcceptAction}
        onReject={handleReject}
      />
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
