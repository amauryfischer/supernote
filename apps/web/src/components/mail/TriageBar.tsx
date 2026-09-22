"use client";

/**
 * TriageBar — barre d'actions de triage d'un thread Gmail (Done / Archive /
 * Snooze), à monter dans la zone d'actions d'une vue thread.
 *
 * Comportement :
 *  - Done / Archive : retirent le thread de l'inbox (mutation `INBOX` côté
 *    Gmail via `applyTriage`). On désactive la barre pendant l'appel ; le
 *    bouton passe en chargement puis succès, ou en erreur (message en infobulle).
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

import { useCallback, useState, type ReactNode } from "react";
import { Button } from "@heroui/react";
import { Archive, CheckCircle, Clock, Trash } from "@phosphor-icons/react";
import { Tooltip } from "@supernote/ui";
import {
  addSnooze,
  applyTriage,
  removeSnooze,
  type TriageAction,
} from "@/lib/mail-triage";
import { useActionFeedback, FeedbackIcon } from "@/lib/action-feedback";
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

export function TriageBar({ clientId, threadId, onTriaged, onTriage }: TriageBarProps) {
  const fb = useActionFeedback();
  // Action dont le bouton porte le retour (chargement, succès, erreur).
  const [target, setTarget] = useState<TriageAction | null>(null);
  const [snoozeOpen, setSnoozeOpen] = useState(false);
  const busy = fb.isPending;
  const withFeedback = fb.run;

  const runMutation = useCallback(
    async (action: TriageAction) => {
      await applyTriage(clientId, threadId, action);
      onTriaged?.(action);
    },
    [clientId, threadId, onTriaged],
  );

  const handleSimple = useCallback(
    (action: "done" | "archive" | "delete") => {
      if (onTriage) {
        onTriage(action);
        return;
      }
      setTarget(action);
      void withFeedback(() => runMutation(action));
    },
    [runMutation, onTriage, withFeedback],
  );

  const handleSnooze = useCallback(
    (until: number) => {
      if (onTriage) {
        onTriage("snooze", until);
        return;
      }
      setTarget("snooze");
      // Optimiste : on note l'échéance AVANT la mutation réseau, et on l'annule
      // si Gmail refuse — le thread toujours en inbox ne doit pas rester « snoozé ».
      addSnooze(threadId, until);
      void withFeedback(
        () => runMutation("snooze"),
        () => removeSnooze(threadId),
      );
    },
    [threadId, runMutation, onTriage, withFeedback],
  );

  const icon = (action: TriageAction, idle: ReactNode) =>
    target === action ? <FeedbackIcon state={fb.state} error={fb.error} size={18} idle={idle} /> : idle;
  const tip = (action: TriageAction, label: string) =>
    target === action && fb.error ? fb.error : label;

  return (
    <div className="flex items-center gap-1" role="group" aria-label="Triage du fil">
      <Tooltip content={tip("done", "Marquer comme fait")}>
        <Button
          variant="ghost"
          size="sm"
          isIconOnly
          onPress={() => handleSimple("done")}
          isDisabled={busy}
          className="h-9"
          aria-label="Marquer comme fait"
        >
          {icon("done", <CheckCircle size={18} weight="bold" aria-hidden />)}
        </Button>
      </Tooltip>

      <Tooltip content={tip("archive", "Archiver")}>
        <Button
          variant="ghost"
          size="sm"
          isIconOnly
          onPress={() => handleSimple("archive")}
          isDisabled={busy}
          className="h-9"
          aria-label="Archiver"
        >
          {icon("archive", <Archive size={18} aria-hidden />)}
        </Button>
      </Tooltip>

      <Tooltip content={tip("snooze", "Reporter (h)")}>
        <Button
          variant="ghost"
          size="sm"
          isIconOnly
          onPress={() => setSnoozeOpen(true)}
          isDisabled={busy}
          className="h-9"
          aria-label="Reporter (snooze)"
        >
          {icon("snooze", <Clock size={18} aria-hidden />)}
        </Button>
      </Tooltip>
      <SnoozeMenu isOpen={snoozeOpen} onClose={() => setSnoozeOpen(false)} onPick={handleSnooze} />

      <Tooltip content={tip("delete", "Supprimer (corbeille)")}>
        <Button
          variant="ghost"
          size="sm"
          isIconOnly
          onPress={() => handleSimple("delete")}
          isDisabled={busy}
          className="h-9"
          aria-label="Supprimer (corbeille)"
        >
          {icon("delete", <Trash size={18} aria-hidden />)}
        </Button>
      </Tooltip>
    </div>
  );
}
