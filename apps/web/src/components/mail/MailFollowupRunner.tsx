"use client";

/**
 * MailFollowupRunner — déclenche les rappels de relance arrivés à échéance.
 *
 * Monté dans le shell, comme la file d'envoi : un rappel posé lundi doit
 * tomber même si on n'est pas sur /mail à ce moment-là.
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
import { getThread, modifyThreadLabels } from "@/lib/gmail";
import { INBOX_LABEL } from "@/lib/mail-triage";
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
  const { toast } = useToast();
  const clientId = settings.googleDrive.clientId.trim();
  const connected = Boolean(settings.gmail.connectedEmail);
  const inFlightRef = useRef<Set<string>>(new Set());
  const toastRef = useRef(toast);
  toastRef.current = toast;

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
    };

    const id = setInterval(tick, TICK_MS);
    tick(); // rattrape les échéances passées pendant la fermeture de l'app
    const onChange = () => tick();
    window.addEventListener(MAIL_FOLLOWUP_EVENT, onChange);
    return () => {
      clearInterval(id);
      window.removeEventListener(MAIL_FOLLOWUP_EVENT, onChange);
    };
  }, [clientId, connected]);

  return null;
}
