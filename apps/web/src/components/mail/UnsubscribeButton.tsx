"use client";

/**
 * UnsubscribeButton — « se désabonner » depuis la vue d'un email.
 *
 * Trois chemins, du plus propre au plus dégradé :
 *  1. POST « un clic » (RFC 8058) quand l'expéditeur l'annonce : rien à faire
 *     de plus, et on dit franchement qu'on ne peut pas confirmer la prise en
 *     compte (réponse opaque en navigateur) ;
 *  2. page de désabonnement ouverte dans un onglet ;
 *  3. désabonnement par email : on pré-remplit le composeur plutôt que
 *     d'envoyer un message dans le dos de l'utilisateur.
 *
 * Après coup, un toast propose d'archiver et de bloquer l'expéditeur — c'est
 * presque toujours la suite voulue, mais elle reste un choix.
 */

import { Button } from "@heroui/react";
import { useToast } from "@supernote/ui";
import { ProhibitInset } from "@phosphor-icons/react";
import { getMessageHeaders, type EmailMessage } from "@/lib/gmail";
import {
  parseListUnsubscribeHeader,
  unsubscribeFromBody,
  postOneClickUnsubscribe,
  type UnsubscribeTargets,
} from "@/lib/mail-unsubscribe";
import { useActionFeedback, FeedbackIcon } from "@/lib/action-feedback";

export function UnsubscribeButton({
  message,
  clientId,
  className,
  /** Pré-remplit le composeur (désabonnement par email). */
  onCompose,
  /** Archive le fil et bloque l'expéditeur (proposé après coup). */
  onBlockAndArchive,
}: {
  message: EmailMessage;
  clientId: string;
  className?: string;
  onCompose?: (prefill: { to: string; subject: string; body: string }) => void;
  onBlockAndArchive?: () => void;
}) {
  const { toast } = useToast();
  const fb = useActionFeedback();

  const offerCleanup = () => {
    if (!onBlockAndArchive) return;
    toast({
      title: "Désabonnement demandé",
      description: "Archiver ce fil et bloquer l'expéditeur ?",
      duration: 8000,
      action: { label: "Archiver et bloquer", onClick: onBlockAndArchive },
    });
  };

  const run = () =>
    fb.run(async () => {
      // L'en-tête n'est pas mirroré : on le lit au moment d'agir.
      let targets: UnsubscribeTargets | null = null;
      try {
        const headers = await getMessageHeaders(clientId, message.id, [
          "List-Unsubscribe",
          "List-Unsubscribe-Post",
        ]);
        targets = parseListUnsubscribeHeader(
          headers["list-unsubscribe"] ?? "",
          headers["list-unsubscribe-post"],
        );
      } catch {
        /* en-tête illisible → on retombe sur le corps */
      }
      targets ??= unsubscribeFromBody(message.bodyHtml);

      if (!targets) throw new Error("Aucun lien de désabonnement");

      if (targets.oneClick && targets.url) {
        const sent = await postOneClickUnsubscribe(targets.url);
        if (sent) offerCleanup();
        else window.open(targets.url, "_blank", "noopener,noreferrer");
        return;
      }

      if (targets.url) {
        window.open(targets.url, "_blank", "noopener,noreferrer");
        offerCleanup();
        return;
      }

      if (targets.mailto) {
        onCompose?.({
          to: targets.mailto,
          subject: targets.mailtoSubject || "Unsubscribe",
          body: "Unsubscribe",
        });
        offerCleanup();
      }
    });

  return (
    <Button
      variant="ghost"
      className={className}
      onPress={() => void run()}
      isDisabled={fb.isPending}
      aria-label="Se désabonner de cet expéditeur"
    >
      <FeedbackIcon state={fb.state} error={fb.error} size={16} idle={<ProhibitInset size={16} />} />
      <span>{fb.state === "error" ? fb.error : "Se désabonner"}</span>
    </Button>
  );
}
