import { useCallback } from "react";
import { useSettings } from "@/components/settings/SettingsContext";
import { sendMessage, type OutgoingAttachment } from "@/lib/gmail";

export interface SendMessageOptions {
  to?: string | string[];
  cc?: string | string[];
  subject: string;
  body: string;
  /** Pièces jointes (base64 standard) — message multipart/mixed si non vide. */
  attachments?: OutgoingAttachment[];
}

/**
 * Envoie un nouveau message Gmail (hors fil) — ⚠️ IRRÉVERSIBLE. Réutilise le
 * Client ID Google (Drive) ; nécessite Gmail connecté. Scope `gmail.compose`
 * (autorise l'envoi) demandé en incrémental par `sendMessage`. Jumeau de
 * `useCreateDraft`.
 */
export function useSendMessage() {
  const { settings } = useSettings();
  const sendMessageFn = useCallback(
    async (opts: SendMessageOptions): Promise<void> => {
      const clientId = settings.googleDrive?.clientId?.trim() ?? "";
      if (!clientId) {
        throw new Error("Google n'est pas configuré (Paramètres → Google Drive).");
      }
      if (!settings.gmail?.connectedEmail) {
        throw new Error("Gmail n'est pas connecté (Paramètres → Gmail).");
      }
      await sendMessage(clientId, opts);
    },
    [settings.googleDrive?.clientId, settings.gmail?.connectedEmail],
  );
  return { sendMessage: sendMessageFn };
}
