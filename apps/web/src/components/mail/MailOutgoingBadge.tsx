"use client";

/**
 * MailOutgoingBadge — état de la file d'envoi : messages programmés et envois
 * en échec.
 *
 * Invisible quand la file est vide. Un envoi programmé qui ne serait signalé
 * nulle part serait pire que pas d'envoi programmé du tout : on l'affiche, on
 * le liste, et on peut l'annuler ou le faire partir tout de suite.
 */

import { useEffect, useState } from "react";
import { Button, Popover } from "@heroui/react";
import { Clock, WarningCircle, PaperPlaneTilt, X } from "@phosphor-icons/react";
import { Tooltip, useToast } from "@supernote/ui";
import {
  loadOutgoing,
  scheduledOutgoing,
  failedOutgoing,
  cancelOutgoing,
  rescheduleOutgoing,
  retryOutgoing,
  MAIL_OUTGOING_EVENT,
  type OutgoingMessage,
} from "@/lib/mail-outgoing";

/** Date lisible, courte : « demain 08:00 », « 14/03 09:30 ». */
function formatWhen(ts: number): string {
  const d = new Date(ts);
  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  const tomorrow = new Date(today.getTime() + 86400000);
  if (sameDay) return `aujourd'hui ${time}`;
  if (d.toDateString() === tomorrow.toDateString()) return `demain ${time}`;
  return `${d.toLocaleDateString([], { day: "2-digit", month: "2-digit" })} ${time}`;
}

export function MailOutgoingBadge() {
  const { toast } = useToast();
  const [items, setItems] = useState<OutgoingMessage[]>(() => loadOutgoing());
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const refresh = () => setItems(loadOutgoing());
    window.addEventListener(MAIL_OUTGOING_EVENT, refresh);
    // La file avance toute seule (le runner envoie) : on rafraîchit la vue à
    // intervalle lent, sans écouter chaque tour.
    const id = setInterval(refresh, 5000);
    return () => {
      window.removeEventListener(MAIL_OUTGOING_EVENT, refresh);
      clearInterval(id);
    };
  }, []);

  const scheduled = scheduledOutgoing(Date.now(), items);
  const failed = failedOutgoing(items);
  if (scheduled.length === 0 && failed.length === 0) return null;

  const danger = failed.length > 0;

  return (
    <Popover isOpen={open} onOpenChange={setOpen}>
      <Tooltip
        content={
          danger
            ? `${failed.length} envoi(s) en échec`
            : `${scheduled.length} envoi(s) programmé(s)`
        }
      >
        <Button
          variant="ghost"
          size="sm"
          aria-label={
            danger
              ? `${failed.length} envoi(s) en échec`
              : `${scheduled.length} envoi(s) programmé(s)`
          }
          style={danger ? { color: "var(--color-warning, #b45309)" } : undefined}
        >
          {danger ? (
            <WarningCircle size={16} weight="fill" aria-hidden />
          ) : (
            <Clock size={16} aria-hidden />
          )}
          <span className="ml-1 text-xs">{danger ? failed.length : scheduled.length}</span>
        </Button>
      </Tooltip>
      <Popover.Content className="w-80 p-1">
        <Popover.Dialog className="outline-none">
          <div className="flex flex-col gap-0.5">
            {failed.map((m) => (
              <div key={m.id} className="flex flex-col gap-1 rounded-md p-2">
                <span className="truncate text-sm font-medium" style={{ color: "var(--text-primary)" }}>
                  {m.subject || "(sans objet)"}
                </span>
                <span className="text-xs" style={{ color: "var(--color-danger, #ef4444)" }}>
                  Échec : {m.lastError ?? "erreur inconnue"}
                </span>
                <div className="flex gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 min-h-7 px-2 text-xs"
                    onPress={() => {
                      retryOutgoing(m.id);
                      setItems(loadOutgoing());
                    }}
                  >
                    Réessayer
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 min-h-7 px-2 text-xs"
                    onPress={() => {
                      cancelOutgoing(m.id);
                      setItems(loadOutgoing());
                      toast({ title: "Envoi abandonné" });
                    }}
                  >
                    Abandonner
                  </Button>
                </div>
              </div>
            ))}
            {scheduled.map((m) => (
              <div key={m.id} className="flex items-center gap-1.5 rounded-md p-2">
                <div className="flex min-w-0 flex-1 flex-col">
                  <span
                    className="truncate text-sm font-medium"
                    style={{ color: "var(--text-primary)" }}
                  >
                    {m.subject || "(sans objet)"}
                  </span>
                  <span className="truncate text-xs" style={{ color: "var(--text-muted)" }}>
                    {m.to.join(", ")} · {formatWhen(m.sendAt)}
                  </span>
                </div>
                <Tooltip content="Envoyer maintenant">
                  <Button
                    size="sm"
                    variant="ghost"
                    isIconOnly
                    aria-label="Envoyer maintenant"
                    className="h-8 min-h-8 w-8 min-w-8"
                    onPress={() => {
                      rescheduleOutgoing(m.id, Date.now());
                      setItems(loadOutgoing());
                    }}
                  >
                    <PaperPlaneTilt size={14} />
                  </Button>
                </Tooltip>
                <Tooltip content="Annuler cet envoi">
                  <Button
                    size="sm"
                    variant="ghost"
                    isIconOnly
                    aria-label="Annuler cet envoi"
                    className="h-8 min-h-8 w-8 min-w-8"
                    onPress={() => {
                      cancelOutgoing(m.id);
                      setItems(loadOutgoing());
                      toast({ title: "Envoi programmé annulé" });
                    }}
                  >
                    <X size={14} />
                  </Button>
                </Tooltip>
              </div>
            ))}
            <p className="px-2 pb-1 pt-0.5 text-[11px]" style={{ color: "var(--text-muted)" }}>
              Les envois programmés partent à l'heure dite si l'app est ouverte,
              sinon à la prochaine ouverture.
            </p>
          </div>
        </Popover.Dialog>
      </Popover.Content>
    </Popover>
  );
}
