"use client";

/**
 * useDeferredSend — envoi d'un message avec fenêtre d'annulation (ou programmé).
 *
 * Point d'entrée unique du composeur et de la réponse inline. Trois issues :
 *
 *  - fenêtre d'annulation > 0 → le message est mis en FILE et part à
 *    l'expiration ; un toast propose « Annuler » pendant tout le délai ;
 *  - date explicite (`sendAt`) → mise en file jusqu'à cette date, visible et
 *    annulable dans `MailOutgoingBadge` ;
 *  - délai nul, ou charge trop lourde pour le stockage local (grosses pièces
 *    jointes) → envoi immédiat, confirmé par le bouton de l'appelant.
 *
 * L'envoi réel est fait par `MailOutgoingRunner`, monté dans le shell : quitter
 * la page Mail n'annule rien.
 */

import { useCallback } from "react";
import { useToast } from "@supernote/ui";
import { useSettings } from "@/components/settings/SettingsContext";
import { sendMessage, sendReply, type OutgoingAttachment } from "@/lib/gmail";
import { enqueueOutgoing, cancelOutgoing, queueTooLarge } from "@/lib/mail-outgoing";

export interface DeferredSendInput {
  kind: "message" | "reply";
  to: string[];
  cc?: string[];
  subject: string;
  body: string;
  html?: string;
  threadId?: string;
  inReplyTo?: string;
  references?: string;
  attachments?: OutgoingAttachment[];
}

export interface DeferredSendOptions {
  /** Date d'envoi explicite (« envoyer plus tard »). */
  sendAt?: number;
  /** Libellé du toast d'annulation (défaut : « Message envoyé »). */
  label?: string;
}

export type DeferredSendResult = "queued" | "sent";

export function useDeferredSend() {
  const { settings } = useSettings();
  const { toast } = useToast();
  const clientId = settings.googleDrive.clientId.trim();
  const undoSeconds = Math.max(0, settings.gmail.undoSendSeconds ?? 0);

  const sendNow = useCallback(
    async (input: DeferredSendInput) => {
      if (input.kind === "reply" && input.threadId) {
        await sendReply(clientId, {
          threadId: input.threadId,
          to: input.to,
          ...(input.cc?.length ? { cc: input.cc } : {}),
          subject: input.subject,
          body: input.body,
          ...(input.html ? { html: input.html } : {}),
          ...(input.inReplyTo ? { inReplyTo: input.inReplyTo } : {}),
          ...(input.references ? { references: input.references } : {}),
          ...(input.attachments?.length ? { attachments: input.attachments } : {}),
        });
        return;
      }
      await sendMessage(clientId, {
        to: input.to,
        ...(input.cc?.length ? { cc: input.cc } : {}),
        subject: input.subject,
        body: input.body,
        ...(input.html ? { html: input.html } : {}),
        ...(input.attachments?.length ? { attachments: input.attachments } : {}),
      });
    },
    [clientId],
  );

  /**
   * Programme (ou envoie) un message. Lève si l'envoi immédiat échoue ; la mise
   * en file, elle, ne peut pas échouer silencieusement (retour `sent` si le
   * stockage refuse, après un envoi direct).
   */
  const scheduleSend = useCallback(
    async (input: DeferredSendInput, opts: DeferredSendOptions = {}): Promise<DeferredSendResult> => {
      if (!clientId) throw new Error("Google n'est pas configuré (Paramètres → Google Drive).");
      const explicit = typeof opts.sendAt === "number";
      const delayMs = explicit ? Math.max(0, opts.sendAt! - Date.now()) : undoSeconds * 1000;

      const entry = {
        kind: input.kind,
        to: input.to,
        ...(input.cc?.length ? { cc: input.cc } : {}),
        subject: input.subject,
        body: input.body,
        ...(input.html ? { html: input.html } : {}),
        ...(input.threadId ? { threadId: input.threadId } : {}),
        ...(input.inReplyTo ? { inReplyTo: input.inReplyTo } : {}),
        ...(input.references ? { references: input.references } : {}),
        ...(input.attachments?.length ? { attachments: input.attachments } : {}),
        sendAt: Date.now() + delayMs,
      };

      if (delayMs <= 0) {
        await sendNow(input);
        return "sent";
      }

      // Charge trop lourde pour la file locale : mieux vaut un envoi non
      // annulable qu'un message perdu au rechargement.
      if (queueTooLarge(entry)) {
        await sendNow(input);
        return "sent";
      }

      const id = enqueueOutgoing(entry);
      if (!id) {
        // Stockage indisponible (quota, navigation privée) → envoi direct.
        await sendNow(input);
        return "sent";
      }

      if (explicit) return "queued";

      toast({
        title: opts.label ?? "Message envoyé",
        description: `Départ dans ${undoSeconds} s.`,
        duration: undoSeconds * 1000,
        action: {
          label: "Annuler l'envoi",
          onClick: () => {
            if (cancelOutgoing(id)) {
              toast({ title: "Envoi annulé", variant: "warning" });
            } else {
              toast({ title: "Trop tard : le message est parti", variant: "warning" });
            }
          },
        },
      });
      return "queued";
    },
    [clientId, undoSeconds, sendNow, toast],
  );

  return { scheduleSend, undoSeconds };
}
