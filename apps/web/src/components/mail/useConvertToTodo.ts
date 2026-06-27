"use client";

import { useCallback, useState } from "react";
import { useToast } from "@supernote/ui";
import { modifyThreadLabels } from "@/lib/gmail";
import { INBOX_LABEL } from "@/lib/mail-triage";
import { quadrantToTodoFields, type EisenhowerQuadrant } from "@/lib/mail-eisenhower";
import { addBinding, updateBindingSummary, buildTodoProvenanceFields } from "@/lib/mail-todo-binding";
import { isAiConfigured, summarizeThread, type MailAiThread } from "@/lib/mail-ai";
import { trpcVanillaClient } from "@/lib/trpc/client";
import { TODO_TYPE_ID } from "@/hooks/useTodoSync";

export interface ConvertToTodoInput {
  threadId: string;
  subject: string;
  quadrant: EisenhowerQuadrant;
  /** Aperçu compact (snippet Gmail) — affiché dans la tâche. */
  snippet?: string;
  /** Nom + email du correspondant (clarté « lié à un email »). */
  fromName?: string;
  fromEmail?: string;
  /** Fil complet (texte brut) pour générer un résumé IA en arrière-plan. Quand
   *  absent (ex : conversion depuis une ligne de liste), on garde le snippet. */
  aiThread?: MailAiThread;
}

/**
 * Conversion email → tâche Eisenhower, réutilisable depuis la vue lecture
 * (`EmailThreadView`) ET le menu contextuel de la liste (`MailOverlayList`).
 *
 * Ordre (cohérent avec l'ancienne logique inline) : crée l'entité `todo` (mêmes
 * champs que /todos standalone + axes du quadrant), PUIS sort le fil de l'inbox
 * (retrait du label INBOX). On n'écrit la liaison locale (`addBinding`) et on ne
 * renvoie `true` (→ l'appelant masque le fil) QU'APRÈS le succès de la mutation
 * Gmail. Si elle échoue : pas de binding (le fil reste visible), la tâche déjà
 * créée reste dans /todos, toast d'erreur — rollback partiel volontaire, non
 * silencieux. Verrou `busy` anti-double.
 */
export function useConvertToTodo(clientId: string): {
  convert: (input: ConvertToTodoInput) => Promise<boolean>;
  busy: boolean;
} {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);

  const convert = useCallback(
    async ({ threadId, subject, quadrant, snippet, fromName, fromEmail, aiThread }: ConvertToTodoInput): Promise<boolean> => {
      if (!clientId || busy) return false;
      const text = subject.trim() || "Email sans sujet";
      setBusy(true);
      try {
        const fields = quadrantToTodoFields(quadrant);
        const todo = await trpcVanillaClient.entities.create.mutate({
          typeId: TODO_TYPE_ID,
          fields: {
            text,
            done: false,
            priority: 5,
            importance: fields.importance,
            urgent: fields.urgent,
            // Provenance email durable (miroir coffre) : permet à
            // `reconcileBindings` de reconstruire la liaison si le store
            // localStorage est perdu (cache vidé, autre origine en dev).
            ...buildTodoProvenanceFields({ threadId, fromName, fromEmail, snippet }),
          },
        });
        await modifyThreadLabels(clientId, threadId, {
          addLabelIds: [],
          removeLabelIds: [INBOX_LABEL],
        });
        addBinding({
          threadId,
          todoId: todo.id,
          quadrant,
          subject: text,
          ...(snippet ? { snippet } : {}),
          ...(fromName ? { fromName } : {}),
          ...(fromEmail ? { fromEmail } : {}),
          createdAt: Date.now(),
        });
        // Résumé IA en arrière-plan (best-effort) : ne bloque pas la conversion.
        // Quand il arrive, on patche la liaison + on notifie les vues (event).
        if (aiThread && isAiConfigured()) {
          void summarizeThread(aiThread)
            .then((s) => {
              const trimmed = s.trim();
              if (trimmed) updateBindingSummary(threadId, trimmed);
            })
            .catch(() => {
              /* Ollama injoignable → on garde le snippet, pas de bruit UI. */
            });
        }
        toast({ title: "Email converti en tâche", variant: "success" });
        return true;
      } catch (e) {
        toast({
          title: "Échec de la conversion en tâche",
          description: e instanceof Error ? e.message : String(e),
          variant: "danger",
        });
        return false;
      } finally {
        setBusy(false);
      }
    },
    [clientId, busy, toast],
  );

  return { convert, busy };
}
