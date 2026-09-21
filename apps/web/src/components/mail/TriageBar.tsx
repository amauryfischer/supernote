"use client";

/**
 * TriageBar — barre d'actions de triage d'un thread Gmail (Done / Archive /
 * Snooze), à monter dans la zone d'actions d'une vue thread.
 *
 * Comportement :
 *  - Done / Archive : retirent le thread de l'inbox (mutation `INBOX` côté
 *    Gmail via `applyTriage`). Optimiste : on désactive la barre pendant
 *    l'appel ; en cas d'échec on toast et on réactive.
 *  - Snooze : ouvre la barre `SnoozeMenu` (saisie libre 10d / 32h + échéances
 *    rapides). Au choix, on enregistre l'échéance dans le store local (`addSnooze`) PUIS on applique la
 *    mutation Gmail. Si la mutation échoue, on annule l'échéance locale
 *    (`removeSnooze`) pour ne pas laisser un thread « snoozé » mais toujours en
 *    inbox.
 *
 * Le composant ne sait rien de la liste parente : il signale chaque triage
 * réussi via `onTriaged(action)` pour que l'appelant retire la carte / passe au
 * thread suivant.
 *
 * UI : boutons icône-seule (h-9 ≈ 36px hit-target tactile) + `Tooltip` au survol.
 */

import { useCallback, useState } from "react";
import { Button } from "@heroui/react";
import { Archive, CheckCircle, Clock, Trash } from "@phosphor-icons/react";
import { useToast, Tooltip } from "@supernote/ui";
import {
  addSnooze,
  applyTriage,
  removeSnooze,
  type TriageAction,
} from "@/lib/mail-triage";
import { SnoozeMenu } from "./SnoozeMenu";

export interface TriageBarProps {
  /** OAuth client ID Google (réutilisé pour le scope gmail.modify). */
  clientId: string;
  /** Thread Gmail ciblé par les actions. */
  threadId: string;
  /** Appelé après un triage réussi (l'appelant retire / avance le thread). */
  onTriaged?: (action: TriageAction) => void;
  /** Délègue tout le triage à l'appelant (outbox, report, « Annuler ») à la place de l'appel Gmail direct. */
  onTriage?: (action: TriageAction, until?: number) => void;
}

/** Libellés utilisateur des actions, pour les toasts. */
const ACTION_LABEL: Record<TriageAction, string> = {
  done: "Fait",
  archive: "Archivé",
  snooze: "Reporté",
  delete: "Supprimé",
};

export function TriageBar({ clientId, threadId, onTriaged, onTriage }: TriageBarProps) {
  const { toast } = useToast();
  // Action en cours (verrouille toute la barre pendant la mutation).
  const [pending, setPending] = useState<TriageAction | null>(null);
  const [snoozeOpen, setSnoozeOpen] = useState(false);
  const busy = pending !== null;

  const runMutation = useCallback(
    async (action: TriageAction) => {
      try {
        await applyTriage(clientId, threadId, action);
        // Quand un parent gère le post-triage (`onTriaged`), il prend en charge
        // la notification — et propose l'« Annuler » (toast-action) côté page
        // Mail. On évite donc un double toast ici ; le toast de confirmation
        // local ne sert qu'aux usages autonomes de la barre (sans `onTriaged`).
        if (onTriaged) {
          onTriaged(action);
        } else {
          toast({ title: ACTION_LABEL[action], variant: "success" });
        }
      } catch (e) {
        throw e instanceof Error ? e : new Error(String(e));
      }
    },
    [clientId, threadId, onTriaged, toast],
  );

  const handleSimple = useCallback(
    (action: "done" | "archive" | "delete") => {
      if (onTriage) {
        onTriage(action);
        return;
      }
      setPending(action);
      void runMutation(action)
        .catch((e: Error) => {
          toast({
            title: "Échec du triage",
            description: e.message,
            variant: "danger",
          });
        })
        .finally(() => setPending(null));
    },
    [runMutation, toast, onTriage],
  );

  const handleSnooze = useCallback(
    (until: number) => {
      if (onTriage) {
        onTriage("snooze", until);
        return;
      }
      setPending("snooze");
      // Optimiste : on note l'échéance AVANT la mutation réseau.
      addSnooze(threadId, until);
      void runMutation("snooze")
        .catch((e: Error) => {
          // Rollback de l'échéance locale : la mutation Gmail a échoué, le
          // thread est toujours en inbox → il ne doit pas rester « snoozé ».
          removeSnooze(threadId);
          toast({
            title: "Échec du report",
            description: e.message,
            variant: "danger",
          });
        })
        .finally(() => setPending(null));
    },
    [threadId, runMutation, toast, onTriage],
  );

  return (
    <div className="flex items-center gap-1" role="group" aria-label="Triage du fil">
      <Tooltip content="Marquer comme fait">
        <Button
          variant="ghost"
          size="sm"
          isIconOnly
          onPress={() => handleSimple("done")}
          isDisabled={busy}
          className="h-9"
          aria-label="Marquer comme fait"
        >
          <CheckCircle size={18} weight="bold" aria-hidden />
        </Button>
      </Tooltip>

      <Tooltip content="Archiver">
        <Button
          variant="ghost"
          size="sm"
          isIconOnly
          onPress={() => handleSimple("archive")}
          isDisabled={busy}
          className="h-9"
          aria-label="Archiver"
        >
          <Archive size={18} aria-hidden />
        </Button>
      </Tooltip>

      <Tooltip content="Reporter (h)">
        <Button
          variant="ghost"
          size="sm"
          isIconOnly
          onPress={() => setSnoozeOpen(true)}
          isDisabled={busy}
          className="h-9"
          aria-label="Reporter (snooze)"
        >
          <Clock size={18} aria-hidden />
        </Button>
      </Tooltip>
      <SnoozeMenu isOpen={snoozeOpen} onClose={() => setSnoozeOpen(false)} onPick={handleSnooze} />

      <Tooltip content="Supprimer (corbeille)">
        <Button
          variant="ghost"
          size="sm"
          isIconOnly
          onPress={() => handleSimple("delete")}
          isDisabled={busy}
          className="h-9"
          aria-label="Supprimer (corbeille)"
        >
          <Trash size={18} aria-hidden />
        </Button>
      </Tooltip>
    </div>
  );
}
