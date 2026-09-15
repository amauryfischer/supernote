"use client";

/**
 * FollowupButton — pose un rappel de relance sur le fil ouvert.
 *
 * « Me rappeler si pas de réponse » : le fil sort de la boîte comme un report,
 * mais ne revient QUE si personne n'a répondu d'ici là. Quand un rappel existe
 * déjà, le bouton affiche son échéance et permet de le retirer.
 */

import { useEffect, useState } from "react";
import { Button, Popover, Input } from "@heroui/react";
import { BellRinging } from "@phosphor-icons/react";
import { useToast } from "@supernote/ui";
import {
  addFollowup,
  removeFollowup,
  getFollowup,
  inDaysAt9,
  FOLLOWUP_PRESETS,
  MAIL_FOLLOWUP_EVENT,
  type FollowupEntry,
} from "@/lib/mail-followup";

/** Date locale formatée pour un `<input type="datetime-local">`. */
function toLocalInputValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function FollowupButton({
  threadId,
  subject,
  messageCount,
  /** Délai par défaut (réglages) — présélection de la saisie libre. */
  defaultDays,
  /** Style de ligne du menu « Plus » de la vue fil. */
  className,
}: {
  threadId: string;
  subject: string;
  messageCount: number;
  defaultDays: number;
  className?: string;
}) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [existing, setExisting] = useState<FollowupEntry | null>(() => getFollowup(threadId));
  const [custom, setCustom] = useState(() =>
    toLocalInputValue(new Date(inDaysAt9(defaultDays))),
  );

  useEffect(() => {
    const refresh = () => setExisting(getFollowup(threadId));
    refresh();
    window.addEventListener(MAIL_FOLLOWUP_EVENT, refresh);
    return () => window.removeEventListener(MAIL_FOLLOWUP_EVENT, refresh);
  }, [threadId]);

  const place = (dueAt: number) => {
    addFollowup({ threadId, subject, messageCount, dueAt });
    setOpen(false);
    const when = new Date(dueAt);
    toast({
      title: "Rappel posé",
      description: `Si personne n'a répondu d'ici le ${when.toLocaleDateString()} à ${when.toLocaleTimeString(
        [],
        { hour: "2-digit", minute: "2-digit" },
      )}, le fil revient en boîte.`,
    });
  };

  const customTs = Date.parse(custom);
  const customValid = Number.isFinite(customTs) && customTs > Date.now();

  return (
    <Popover isOpen={open} onOpenChange={setOpen}>
      <Button
        variant="ghost"
        className={className}
        aria-label="Me rappeler si pas de réponse"
      >
        <BellRinging size={16} weight={existing ? "fill" : "regular"} />
        <span>
          {existing
            ? `Rappel le ${new Date(existing.dueAt).toLocaleDateString()}`
            : "Me rappeler si pas de réponse"}
        </span>
      </Button>
      <Popover.Content className="w-72 p-1">
        <Popover.Dialog className="outline-none">
          <div className="flex flex-col gap-0.5">
            {existing && (
              <Button
                variant="ghost"
                size="sm"
                className="h-9 w-full justify-start"
                onPress={() => {
                  removeFollowup(threadId);
                  setOpen(false);
                  toast({ title: "Rappel retiré" });
                }}
              >
                Retirer le rappel
              </Button>
            )}
            {FOLLOWUP_PRESETS.map((p) => (
              <Button
                key={p.id}
                variant="ghost"
                size="sm"
                className="h-9 w-full justify-start"
                onPress={() => place(inDaysAt9(p.days))}
              >
                {p.label}
              </Button>
            ))}
            <div
              className="mt-1 flex items-center gap-1.5 border-t pt-2"
              style={{ borderColor: "var(--border-subtle)" }}
            >
              <Input
                type="datetime-local"
                value={custom}
                onChange={(e) => setCustom(e.target.value)}
                className="flex-1"
                aria-label="Date du rappel"
              />
              <Button
                variant="primary"
                size="sm"
                isDisabled={!customValid}
                onPress={() => place(customTs)}
              >
                Poser
              </Button>
            </div>
          </div>
        </Popover.Dialog>
      </Popover.Content>
    </Popover>
  );
}
