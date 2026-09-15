"use client";

/**
 * MailOutgoingRunner — vidange la file d'envoi différé (annulation, envoi
 * programmé).
 *
 * Monté une fois dans le shell, jamais dans la page Mail : un message mis en
 * file doit partir même si on a quitté /mail entre-temps. Il ne rend rien —
 * seulement des toasts en cas d'échec.
 *
 * Cadence : un tour par seconde. C'est la granularité attendue par la fenêtre
 * « Annuler l'envoi » (quelques secondes) ; pour un envoi programmé à une date,
 * la précision est celle du tour, ce qui est très au-delà du besoin.
 */

import { useEffect, useRef } from "react";
import { useToast } from "@supernote/ui";
import { useSettings } from "@/components/settings/SettingsContext";
import { sendMessage, sendReply } from "@/lib/gmail";
import {
  dueOutgoing,
  cancelOutgoing,
  recordFailure,
  loadOutgoing,
  MAIL_OUTGOING_EVENT,
  type OutgoingMessage,
} from "@/lib/mail-outgoing";

/** Intervalle de vidange (ms). */
const TICK_MS = 1000;

export function MailOutgoingRunner() {
  const { settings } = useSettings();
  const { toast } = useToast();
  const clientId = settings.googleDrive.clientId.trim();
  const connected = Boolean(settings.gmail.connectedEmail);
  // Envois en vol : un tour ne doit pas relancer ce que le précédent pousse.
  const inFlightRef = useRef<Set<string>>(new Set());
  const toastRef = useRef(toast);
  toastRef.current = toast;

  useEffect(() => {
    if (!clientId || !connected) return undefined;

    const send = async (m: OutgoingMessage) => {
      if (m.kind === "reply" && m.threadId) {
        await sendReply(clientId, {
          threadId: m.threadId,
          to: m.to,
          ...(m.cc?.length ? { cc: m.cc } : {}),
          subject: m.subject,
          body: m.body,
          ...(m.html ? { html: m.html } : {}),
          ...(m.inReplyTo ? { inReplyTo: m.inReplyTo } : {}),
          ...(m.references ? { references: m.references } : {}),
          ...(m.attachments?.length ? { attachments: m.attachments } : {}),
        });
        return;
      }
      await sendMessage(clientId, {
        to: m.to,
        ...(m.cc?.length ? { cc: m.cc } : {}),
        subject: m.subject,
        body: m.body,
        ...(m.html ? { html: m.html } : {}),
        ...(m.attachments?.length ? { attachments: m.attachments } : {}),
      });
    };

    const tick = () => {
      // Onglet en arrière-plan : on laisse passer (les timers y sont bridés,
      // et une requête OAuth silencieuse peut échouer). Le tour suivant, à la
      // reprise, rattrapera les envois dus.
      if (typeof document !== "undefined" && document.hidden) return;
      const due = dueOutgoing(Date.now());
      for (const m of due) {
        if (inFlightRef.current.has(m.id)) continue;
        inFlightRef.current.add(m.id);
        void send(m)
          .then(() => {
            cancelOutgoing(m.id); // sorti de la file : c'est parti
            toastRef.current({ title: "Message envoyé", variant: "success" });
          })
          .catch((err: unknown) => {
            const msg = err instanceof Error ? err.message : String(err);
            recordFailure(m.id, msg);
            const still = loadOutgoing().find((x) => x.id === m.id);
            if (still?.failed) {
              toastRef.current({
                title: "Envoi échoué",
                description: `« ${m.subject || "(sans objet)"} » — ${msg}`,
                variant: "danger",
              });
            }
          })
          .finally(() => {
            inFlightRef.current.delete(m.id);
          });
      }
    };

    const id = setInterval(tick, TICK_MS);
    // Un tour immédiat : à l'ouverture de l'app, les envois dont l'échéance est
    // passée pendant la fermeture partent tout de suite.
    tick();
    const onChange = () => tick();
    window.addEventListener(MAIL_OUTGOING_EVENT, onChange);
    return () => {
      clearInterval(id);
      window.removeEventListener(MAIL_OUTGOING_EVENT, onChange);
    };
  }, [clientId, connected]);

  return null;
}
