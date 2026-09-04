"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useToast } from "@supernote/ui";
import { trpc } from "@/lib/trpc/client";
import { runJournalExtraction } from "@/lib/ai/journal-extract";
import { TODO_TYPE_ID } from "./useTodoSync";
import { useMentionCandidates } from "./useMentionCandidates";
import type { ExtractedAction, MentionMatch } from "@supernote/ai";

// Doit suivre le `noteContent.slice(0, 4000)` de
// `packages/ai/src/extract/ollama-extract.ts` (prompts actions ET mentions).
const OLLAMA_TEXT_LIMIT = 4000;

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

export function useJournalExtraction(dailyEntityId: string | null): UseJournalExtractionResult {
  const candidates = useMentionCandidates();
  const [suggestions, setSuggestions] = useState<JournalSuggestion[]>([]);
  const [truncated, setTruncated] = useState(false);
  const runIdRef = useRef(0);
  // Lus dans `trigger` par référence pour lui garder une identité stable :
  // l'éditeur le capture dans son propre debounce.
  const candidatesRef = useRef(candidates);
  const lastTextRef = useRef("");
  const lastRunCandidateCountRef = useRef(-1);
  const lastEntityIdRef = useRef<string | null>(null);
  const utils = trpc.useUtils();
  const { toast } = useToast();
  const createTodo = trpc.entities.create.useMutation();

  const trigger = useCallback((text: string) => {
    const runId = ++runIdRef.current;
    lastTextRef.current = text;
    lastRunCandidateCountRef.current = candidatesRef.current.length;
    void runJournalExtraction(text, candidatesRef.current).then((result) => {
      // Une frappe plus récente a déjà relancé une passe — ignorer ce résultat périmé.
      if (runId !== runIdRef.current) return;
      setSuggestions([
        ...result.mentions.map(
          (match): MentionSuggestion => ({
            kind: "mention",
            key: `mention:${match.entityId}:${match.startOffset}`,
            match,
          }),
        ),
        ...result.actions.map(
          (action, i): ActionSuggestion => ({
            kind: "action",
            key: `action:${i}:${action.text}`,
            action,
          }),
        ),
      ]);
      // Quand Ollama ne rend rien, l'extracteur rejoue l'heuristique sur le
      // texte ENTIER : la troncature n'est réelle que si un résultat vient
      // effectivement du modèle.
      const fromModel =
        result.mentions.some((m) => m.source === "ollama") ||
        result.actions.some((a) => a.source === "ollama");
      setTruncated(fromModel && text.length > OLLAMA_TEXT_LIMIT);
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
    if (!dailyEntityId || lastEntityIdRef.current === dailyEntityId) return;
    const previous = lastEntityIdRef.current;
    lastEntityIdRef.current = dailyEntityId;
    // `null` → id, c'est la même journée qui finit de charger, pas un
    // changement de date : ne pas jeter les suggestions déjà calculées.
    if (previous === null) return;
    runIdRef.current++;
    lastTextRef.current = "";
    setSuggestions([]);
    setTruncated(false);
  }, [dailyEntityId]);

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
          fields: {
            text: suggestion.action.text,
            done: false,
            importance: suggestion.action.priority,
            ...(suggestion.action.deadline ? { dueDate: suggestion.action.deadline } : {}),
            ...(dailyEntityId ? { sourceNoteId: dailyEntityId } : {}),
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
    [createTodo, dailyEntityId, dismissMention, toast, utils],
  );

  return { suggestions, truncated, trigger, dismissMention, acceptAction };
}
