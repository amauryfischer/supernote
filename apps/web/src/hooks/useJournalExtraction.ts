"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useToast } from "@supernote/ui";
import { OLLAMA_EXTRACT_TEXT_LIMIT } from "@supernote/ai";
import type { ExtractedAction, MentionMatch } from "@supernote/ai";
import { trpc } from "@/lib/trpc/client";
import { runJournalExtraction } from "@/lib/ai/journal-extract";
import { TODO_TYPE_ID } from "./useTodoSync";
import { useMentionCandidates } from "./useMentionCandidates";

const MAX_MENTIONS = 5;
const MAX_ACTIONS = 5;

export interface MentionSuggestion {
  kind: "mention";
  key: string;
  match: MentionMatch;
}

export interface ActionSuggestion {
  kind: "action";
  key: string;
  action: ExtractedAction;
}

export type JournalSuggestion = MentionSuggestion | ActionSuggestion;

interface UseJournalExtractionResult {
  suggestions: JournalSuggestion[];
  /**
   * Texte sur lequel `suggestions` a été calculé. Les offsets des mentions ne
   * valent QUE contre lui : avant de réécrire le markdown, le consommateur doit
   * le comparer au texte courant et refuser (ou relocaliser) si la frappe a
   * continué depuis la passe.
   */
  analyzedText: string;
  /**
   * L'IA a répondu, mais elle n'a lu qu'un préfixe du texte : la fin de
   * l'entrée n'a été analysée par personne. À afficher à l'utilisateur.
   */
  truncated: boolean;
  /** À appeler depuis le tick debounce existant de l'éditeur (Task 6). */
  trigger: (text: string) => void;
  /** Retire une suggestion (mention ou action) SANS toucher au texte. */
  dismissMention: (key: string) => void;
  acceptAction: (suggestion: ActionSuggestion) => void;
}

/**
 * Les offsets d'une mention `ollama` sont des entiers rendus par le modèle,
 * jamais confrontés au texte (`MentionSchema` ne valide qu'un entier positif).
 * On les vérifie, on les relocalise sur la première occurrence de `matchedText`
 * quand c'est possible, et on jette le reste — le consommateur réécrit le
 * markdown à ces positions.
 */
function verifiedOffsets(text: string, match: MentionMatch): MentionMatch | null {
  if (!match.matchedText) return null;
  if (text.slice(match.startOffset, match.endOffset) === match.matchedText) return match;
  const at = text.indexOf(match.matchedText);
  if (at < 0) return null;
  return { ...match, startOffset: at, endOffset: at + match.matchedText.length };
}

/**
 * Une occurrence par entité : l'heuristique émet un match par occurrence, et le
 * libellé d'une chip ne montre que le nom — cinq « Julie » identiques seraient
 * indiscernables. Meilleure confiance d'abord, puis la plus précoce.
 */
function oneMentionPerEntity(matches: MentionMatch[]): MentionMatch[] {
  const best = new Map<string, MentionMatch>();
  for (const match of matches) {
    const current = best.get(match.entityId);
    if (
      !current ||
      match.confidence > current.confidence ||
      (match.confidence === current.confidence && match.startOffset < current.startOffset)
    ) {
      best.set(match.entityId, match);
    }
  }
  return [...best.values()]
    .sort((a, b) => a.startOffset - b.startOffset)
    .slice(0, MAX_MENTIONS);
}

function dedupedActions(actions: ExtractedAction[]): ExtractedAction[] {
  const seen = new Set<string>();
  const out: ExtractedAction[] = [];
  for (const action of actions) {
    const key = action.text.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(action);
    if (out.length === MAX_ACTIONS) break;
  }
  return out;
}

export function useJournalExtraction(date: string): UseJournalExtractionResult {
  const candidates = useMentionCandidates();
  const [suggestions, setSuggestions] = useState<JournalSuggestion[]>([]);
  const [analyzedText, setAnalyzedText] = useState("");
  const [truncated, setTruncated] = useState(false);
  const runIdRef = useRef(0);
  // Lus dans `trigger` par référence pour lui garder une identité stable :
  // l'éditeur le capture dans son propre debounce.
  const candidatesRef = useRef(candidates);
  const lastTextRef = useRef("");
  const lastRunCandidateCountRef = useRef(-1);
  const lastDateRef = useRef(date);
  const utils = trpc.useUtils();
  const { toast } = useToast();
  const createTodo = trpc.entities.create.useMutation();

  const trigger = useCallback((text: string) => {
    const runId = ++runIdRef.current;
    lastTextRef.current = text;
    lastRunCandidateCountRef.current = candidatesRef.current.length;
    runJournalExtraction(text, candidatesRef.current)
      .then((result) => {
        // Une frappe plus récente a déjà relancé une passe — ignorer ce résultat périmé.
        if (runId !== runIdRef.current) return;
        const mentions = oneMentionPerEntity(
          result.mentions
            .map((m) => verifiedOffsets(text, m))
            .filter((m): m is MentionMatch => m !== null),
        );
        const actions = dedupedActions(result.actions);
        setSuggestions([
          ...mentions.map(
            (match): MentionSuggestion => ({
              kind: "mention",
              key: `mention:${match.entityId}`,
              match,
            }),
          ),
          ...actions.map(
            (action, i): ActionSuggestion => ({
              kind: "action",
              key: `action:${i}:${action.text}`,
              action,
            }),
          ),
        ]);
        setAnalyzedText(text);
        // Quand Ollama ne rend rien, l'extracteur rejoue l'heuristique sur le
        // texte ENTIER : la troncature n'est réelle que si un résultat vient
        // effectivement du modèle. Mesuré sur le résultat brut — ce que le
        // modèle a lu ne dépend pas de ce qui survit au filtrage.
        const fromModel =
          result.mentions.some((m) => m.source === "ollama") ||
          result.actions.some((a) => a.source === "ollama");
        setTruncated(fromModel && text.length > OLLAMA_EXTRACT_TEXT_LIMIT);
      })
      .catch((err: unknown) => {
        // Les chemins Ollama sont déjà protégés en interne, pas le repli
        // heuristique, qui construit des RegExp à partir de données du coffre.
        if (runId !== runIdRef.current) return;
        console.error("[journal] extraction échouée", err);
        setSuggestions([]);
        setAnalyzedText(text);
        setTruncated(false);
      });
  }, []);

  useEffect(() => {
    candidatesRef.current = candidates;
    // `useMentionCandidates` rend `[]` pendant son chargement : une passe
    // lancée à ce moment-là ne pouvait voir aucune mention. Rejouer dès que
    // les candidats arrivent, sinon l'utilisateur doit retaper pour les avoir.
    if (candidates.length === 0) return;
    if (candidates.length === lastRunCandidateCountRef.current) return;
    if (!lastTextRef.current.trim()) return;
    trigger(lastTextRef.current);
  }, [candidates, trigger]);

  useEffect(() => {
    if (lastDateRef.current === date) return;
    lastDateRef.current = date;
    // `JournalEditor` n'est pas remonté au changement de date : sans purge, les
    // chips d'hier resteraient affichées avec les offsets d'hier au-dessus du
    // texte d'aujourd'hui. Piloté par la date et non par l'id de l'entité, qui
    // repasse par `null` tant que l'entrée du jour n'est pas créée.
    runIdRef.current++;
    lastTextRef.current = "";
    lastRunCandidateCountRef.current = -1;
    setSuggestions([]);
    setAnalyzedText("");
    setTruncated(false);
  }, [date]);

  const dismissMention = useCallback((key: string) => {
    setSuggestions((prev) => prev.filter((s) => s.key !== key));
  }, []);

  const acceptAction = useCallback(
    (suggestion: ActionSuggestion) => {
      // Retiré d'abord : la chip disparue est le verrou anti-double-clic.
      dismissMention(suggestion.key);
      createTodo
        .mutateAsync({
          typeId: TODO_TYPE_ID,
          // ⚠️ Surtout pas de `sourceNoteId` ici : sur une entité `todo` ce
          // champ marque une entité héritée de l'ancien réconciliateur —
          // /todos la masque, la compte dans la bannière de migration, et
          // `lib/todos/migration.ts` la supprime faute de ligne `- [ ]`
          // correspondante dans le corps de la note.
          fields: {
            text: suggestion.action.text,
            done: false,
            // Défaut de /todos et de useConvertToTodo : sans lui, pas de badge
            // P{n} et un tri différent des autres tâches.
            priority: 5,
            importance: suggestion.action.priority,
            ...(suggestion.action.deadline ? { dueDate: suggestion.action.deadline } : {}),
          },
        })
        .then(() => {
          void utils.entities.list.invalidate({ typeId: TODO_TYPE_ID });
          toast({ title: "Tâche créée", description: suggestion.action.text, variant: "success" });
        })
        .catch((err: unknown) => {
          // La chip a déjà disparu : sans ce toast, l'échec serait invisible.
          toast({
            title: "Tâche non créée",
            description: err instanceof Error ? err.message : suggestion.action.text,
            variant: "danger",
          });
        });
    },
    [createTodo, dismissMention, toast, utils],
  );

  return { suggestions, analyzedText, truncated, trigger, dismissMention, acceptAction };
}
