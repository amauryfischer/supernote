"use client";

/**
 * TriageBar — barre d'actions de triage d'un thread Gmail (Done / Archive /
 * Snooze), à monter dans la zone d'actions d'une vue thread.
 *
 * Comportement :
 *  - Done / Archive : retirent le thread de l'inbox (mutation `INBOX` côté
 *    Gmail via `applyTriage`). Optimiste : on désactive la barre pendant
 *    l'appel ; en cas d'échec on toast et on réactive.
 *  - Snooze : Popover HeroUI avec 3 échéances rapides (Ce soir / Demain / Lundi
 *    prochain), calculées au runtime à partir de `new Date()`. Au choix, on
 *    enregistre l'échéance dans le store local (`addSnooze`) PUIS on applique la
 *    mutation Gmail. Si la mutation échoue, on annule l'échéance locale
 *    (`removeSnooze`) pour ne pas laisser un thread « snoozé » mais toujours en
 *    inbox.
 *
 * Le composant ne sait rien de la liste parente : il signale chaque triage
 * réussi via `onTriaged(action)` pour que l'appelant retire la carte / passe au
 * thread suivant.
 *
 * Mobile : boutons à hit-target tactile (h-9 ≈ 36px), libellés masqués sous
 * `sm` (icône seule) pour éviter tout débordement ; le Popover snooze reste
 * pleine largeur des options.
 */

import { useCallback, useState } from "react";
import { Button, Popover } from "@heroui/react";
import { Archive, CheckCircle, Clock, Trash } from "@phosphor-icons/react";
import { useToast } from "@supernote/ui";
import {
  addSnooze,
  applyTriage,
  removeSnooze,
  SNOOZE_PRESETS,
  type SnoozePreset,
  type TriageAction,
} from "@/lib/mail-triage";

export interface TriageBarProps {
  /** OAuth client ID Google (réutilisé pour le scope gmail.modify). */
  clientId: string;
  /** Thread Gmail ciblé par les actions. */
  threadId: string;
  /** Appelé après un triage réussi (l'appelant retire / avance le thread). */
  onTriaged?: (action: TriageAction) => void;
}

/** Libellés utilisateur des actions, pour les toasts. */
const ACTION_LABEL: Record<TriageAction, string> = {
  done: "Fait",
  archive: "Archivé",
  snooze: "Reporté",
  delete: "Supprimé",
};

export function TriageBar({ clientId, threadId, onTriaged }: TriageBarProps) {
  const { toast } = useToast();
  // Action en cours (verrouille toute la barre pendant la mutation).
  const [pending, setPending] = useState<TriageAction | null>(null);
  // Ouverture contrôlée du Popover snooze (pour le fermer après un choix).
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
    [runMutation, toast],
  );

  const handleSnooze = useCallback(
    (preset: SnoozePreset) => {
      setSnoozeOpen(false);
      setPending("snooze");
      const until = preset.computeUntil(new Date());
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
    [threadId, runMutation, toast],
  );

  return (
    <div className="flex items-center gap-2" role="group" aria-label="Triage du fil">
      <Button
        variant="ghost"
        size="sm"
        onPress={() => handleSimple("done")}
        isDisabled={busy}
        className="h-9 gap-1.5"
        aria-label="Marquer comme fait"
      >
        <CheckCircle size={18} weight="bold" aria-hidden />
        <span className="hidden sm:inline">Fait</span>
      </Button>

      <Button
        variant="ghost"
        size="sm"
        onPress={() => handleSimple("archive")}
        isDisabled={busy}
        className="h-9 gap-1.5"
        aria-label="Archiver"
      >
        <Archive size={18} aria-hidden />
        <span className="hidden sm:inline">Archiver</span>
      </Button>

      <Popover isOpen={snoozeOpen} onOpenChange={setSnoozeOpen}>
        <Button
          variant="ghost"
          size="sm"
          isDisabled={busy}
          className="h-9 gap-1.5"
          aria-label="Reporter (snooze)"
        >
          <Clock size={18} aria-hidden />
          <span className="hidden sm:inline">Reporter</span>
        </Button>
        <Popover.Content className="min-w-44 p-1">
          <Popover.Dialog className="outline-none">
            <div className="flex flex-col" aria-label="Reporter le fil à">
              {SNOOZE_PRESETS.map((preset) => (
                <Button
                  key={preset.id}
                  variant="ghost"
                  size="sm"
                  onPress={() => handleSnooze(preset)}
                  className="h-9 w-full justify-start"
                >
                  {preset.label}
                </Button>
              ))}
            </div>
          </Popover.Dialog>
        </Popover.Content>
      </Popover>

      <Button
        variant="ghost"
        size="sm"
        onPress={() => handleSimple("delete")}
        isDisabled={busy}
        className="h-9 gap-1.5"
        aria-label="Supprimer (corbeille)"
      >
        <Trash size={18} aria-hidden />
        <span className="hidden sm:inline">Supprimer</span>
      </Button>
    </div>
  );
}
