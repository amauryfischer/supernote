"use client";

/**
 * MailFollowupRunner — tâches mail de fond, montées dans le shell pour tourner
 * même hors de /mail : rappels de relance, réveil des fils reportés, vidange de
 * l'outbox au retour du réseau, alerte « reconnexion Gmail requise ».
 *
 * À l'échéance, le fil est vérifié côté Gmail (source de vérité) :
 *  - quelqu'un a répondu → le rappel s'efface, en silence. C'est le cas le plus
 *    fréquent, et c'est exactement le bruit qu'on veut éviter ;
 *  - toujours sans réponse → le fil REVIENT en boîte de réception, avec un
 *    toast qui dit pourquoi il est là.
 */

import { useEffect, useRef } from "react";
import { useToast } from "@supernote/ui";
import { useSettings } from "@/components/settings/SettingsContext";
import { GMAIL_AUTH_EVENT, getThread, gmailReconnectRequired, modifyThreadLabels } from "@/lib/gmail";
import { INBOX_LABEL, listDue, removeSnooze } from "@/lib/mail-triage";
import { mirrorAvailable } from "@/lib/mail-mirror";
import { flushOutbox } from "@/lib/mail-sync";
import { useGmailReconnect } from "./GmailReconnectBanner";
import {
  dueFollowups,
  hasNewMessages,
  removeFollowup,
  MAIL_FOLLOWUP_EVENT,
} from "@/lib/mail-followup";

/** Les rappels se comptent en jours : un tour par minute suffit largement. */
const TICK_MS = 60_000;

export function MailFollowupRunner() {
  const { settings } = useSettings();
  const { toast, dismiss } = useToast();
  const clientId = settings.googleDrive.clientId.trim();
  const accountId = settings.gmail.connectedEmail;
  const connected = Boolean(accountId);
  const inFlightRef = useRef<Set<string>>(new Set());
  const toastRef = useRef(toast);
  toastRef.current = toast;
  const reconnect = useGmailReconnect(clientId);
  const reconnectRef = useRef(reconnect.reconnect);
  reconnectRef.current = reconnect.reconnect;

  useEffect(() => {
    if (!clientId || !connected) return undefined;

    const tick = () => {
      if (typeof document !== "undefined" && document.hidden) return;
      for (const entry of dueFollowups(Date.now())) {
        if (inFlightRef.current.has(entry.threadId)) continue;
        inFlightRef.current.add(entry.threadId);
        void getThread(clientId, entry.threadId)
          .then(async (t) => {
            if (hasNewMessages(entry, t.messages.length)) {
              // Réponse arrivée : le rappel n'a plus d'objet.
              removeFollowup(entry.threadId);
              return;
            }
            await modifyThreadLabels(clientId, entry.threadId, {
              addLabelIds: [INBOX_LABEL],
            });
            removeFollowup(entry.threadId);
            toastRef.current({
              title: "Relance à faire",
              description: `Toujours pas de réponse : « ${entry.subject || "(sans objet)"} »`,
              duration: 8000,
            });
          })
          .catch(() => {
            /* fil illisible (réseau, droits) : on retentera au prochain tour */
          })
          .finally(() => {
            inFlightRef.current.delete(entry.threadId);
          });
      }
      for (const entry of listDue(Date.now())) {
        const key = `snooze:${entry.threadId}`;
        if (inFlightRef.current.has(key)) continue;
        inFlightRef.current.add(key);
        void modifyThreadLabels(clientId, entry.threadId, { addLabelIds: [INBOX_LABEL] })
          .then(() => removeSnooze(entry.threadId))
          .catch(() => {
            /* réveil best-effort : retenté au tour suivant */
          })
          .finally(() => {
            inFlightRef.current.delete(key);
          });
      }
    };

    const id = setInterval(tick, TICK_MS);
    tick(); // rattrape les échéances passées pendant la fermeture de l'app
    const onChange = () => tick();
    window.addEventListener(MAIL_FOLLOWUP_EVENT, onChange);
    // Les timers d'un onglet caché sont bridés : on rattrape au retour.
    document.addEventListener("visibilitychange", onChange);
    return () => {
      clearInterval(id);
      window.removeEventListener(MAIL_FOLLOWUP_EVENT, onChange);
      document.removeEventListener("visibilitychange", onChange);
    };
  }, [clientId, connected]);

  // L'outbox repart dès que Gmail redevient joignable, même hors de /mail.
  useEffect(() => {
    if (!clientId || !accountId) return undefined;
    const flush = () => {
      if (document.hidden || !mirrorAvailable() || gmailReconnectRequired()) return;
      void flushOutbox(clientId, accountId).catch(() => {
        /* l'op reste en file : prochain déclencheur */
      });
    };
    flush();
    window.addEventListener("online", flush);
    window.addEventListener(GMAIL_AUTH_EVENT, flush);
    window.addEventListener("supernote:vault-ready", flush);
    document.addEventListener("visibilitychange", flush);
    return () => {
      window.removeEventListener("online", flush);
      window.removeEventListener(GMAIL_AUTH_EVENT, flush);
      window.removeEventListener("supernote:vault-ready", flush);
      document.removeEventListener("visibilitychange", flush);
    };
  }, [clientId, accountId]);

  // Alerte globale, visible hors de /mail : le bouton du toast est le geste qui
  // autorise la popup Google.
  useEffect(() => {
    if (!connected || !reconnect.required) return undefined;
    const id = toast({
      title: "Reconnexion Gmail requise",
      description: "Les emails ne se synchronisent plus tant que le compte n'est pas reconnecté.",
      variant: "warning",
      duration: 0,
      // Reste ouvert après le clic : il disparaît quand la reconnexion aboutit.
      action: { label: "Reconnecter", onClick: () => reconnectRef.current(), keepOpen: true },
    });
    return () => dismiss(id);
  }, [connected, reconnect.required, toast, dismiss]);

  return null;
}
