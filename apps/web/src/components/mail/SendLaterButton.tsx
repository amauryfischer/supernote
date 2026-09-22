"use client";

/**
 * SendLaterButton — « envoyer plus tard » : programme le départ d'un message.
 *
 * Réutilise la fenêtre d'échéances du report (mêmes repères temporels, même
 * date libre) avec ses propres propositions : l'utilisateur n'a pas deux
 * grammaires de dates à apprendre.
 *
 * Limite affichée honnêtement dans l'infobulle : l'envoi part à l'heure dite
 * SI l'app est ouverte, sinon à la première ouverture suivante — il n'y a pas
 * de serveur Supernote pour poster à notre place.
 */

import { useState } from "react";
import { Button } from "@heroui/react";
import { Tooltip } from "@supernote/ui";
import { Clock } from "@phosphor-icons/react";
import { SnoozeMenu } from "./SnoozeMenu";
import {
  laterToday,
  tonight,
  tomorrowMorning,
  nextMonday,
  type SnoozePreset,
} from "@/lib/mail-triage";

/** Échéances d'envoi différé (formulées côté « départ », pas côté « retour »). */
const SEND_LATER_PRESETS: readonly SnoozePreset[] = [
  { id: "later", label: "Dans 3 heures", computeUntil: laterToday },
  { id: "tonight", label: "Ce soir (18 h)", computeUntil: tonight },
  { id: "tomorrow", label: "Demain matin (8 h)", computeUntil: tomorrowMorning },
  { id: "monday", label: "Lundi matin (8 h)", computeUntil: nextMonday },
];

export function SendLaterButton({
  onPick,
  isDisabled = false,
  /** Rendu compact (icône seule) pour la barre de réponse. */
  iconOnly = false,
}: {
  onPick: (sendAt: number) => void;
  isDisabled?: boolean;
  iconOnly?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Tooltip content="Envoyer plus tard (l'app doit être ouverte à l'heure dite)">
        <Button
          variant="ghost"
          size="sm"
          isIconOnly={iconOnly}
          isDisabled={isDisabled}
          aria-label="Envoyer plus tard"
          onPress={() => setOpen(true)}
        >
          <Clock size={iconOnly ? 14 : 15} aria-hidden />
          {!iconOnly && "Plus tard"}
        </Button>
      </Tooltip>
      <SnoozeMenu
        isOpen={open}
        onClose={() => setOpen(false)}
        onPick={onPick}
        title="Envoyer plus tard"
        presets={SEND_LATER_PRESETS}
        confirmLabel="Programmer"
      />
    </>
  );
}
