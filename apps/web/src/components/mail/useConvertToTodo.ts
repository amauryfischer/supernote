"use client";

import { useCallback, useState } from "react";
import { useToast } from "@supernote/ui";
import { modifyThreadLabels } from "@/lib/gmail";
import { INBOX_LABEL } from "@/lib/mail-triage";
import { quadrantToTodoFields, type EisenhowerQuadrant } from "@/lib/mail-eisenhower";
import { addBinding } from "@/lib/mail-todo-binding";
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
    async ({ threadId, subject, quadrant, snippet, fromName, fromEmail }: ConvertToTodoInput): Promise<boolean> => {
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
