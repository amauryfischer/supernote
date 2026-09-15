"use client";

/**
 * MailFollowupBadge — rappels de relance en attente.
 *
 * Invisible tant qu'il n'y en a pas. Un rappel posé et jamais revu serait une
 * promesse en l'air : on les liste, avec leur échéance, et on peut les retirer.
 */

import { useEffect, useState } from "react";
import { Button, Popover } from "@heroui/react";
import { BellRinging, X } from "@phosphor-icons/react";
import { Tooltip, useToast } from "@supernote/ui";
import {
  loadFollowups,
  pendingFollowups,
  removeFollowup,
  MAIL_FOLLOWUP_EVENT,
  type FollowupEntry,
} from "@/lib/mail-followup";

export function MailFollowupBadge({ onOpenThread }: { onOpenThread?: (id: string) => void }) {
  const { toast } = useToast();
  const [entries, setEntries] = useState<FollowupEntry[]>(() => loadFollowups());
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const refresh = () => setEntries(loadFollowups());
    window.addEventListener(MAIL_FOLLOWUP_EVENT, refresh);
    return () => window.removeEventListener(MAIL_FOLLOWUP_EVENT, refresh);
  }, []);

  const pending = pendingFollowups(Date.now(), entries);
  if (pending.length === 0) return null;

  return (
    <Popover isOpen={open} onOpenChange={setOpen}>
      <Tooltip content={`${pending.length} rappel(s) de relance en attente`}>
        <Button
          variant="ghost"
          size="sm"
          aria-label={`${pending.length} rappel(s) de relance en attente`}
        >
          <BellRinging size={16} aria-hidden />
          <span className="ml-1 text-xs">{pending.length}</span>
        </Button>
      </Tooltip>
      <Popover.Content className="w-80 p-1">
        <Popover.Dialog className="outline-none">
          <div className="flex flex-col gap-0.5">
            {pending.map((e) => (
              <div key={e.threadId} className="flex items-center gap-1.5 rounded-md p-2">
                <button
                  type="button"
                  className="flex min-w-0 flex-1 flex-col text-left"
                  onClick={() => {
                    setOpen(false);
                    onOpenThread?.(e.threadId);
                  }}
                >
                  <span
                    className="truncate text-sm font-medium"
                    style={{ color: "var(--text-primary)" }}
                  >
                    {e.subject || "(sans objet)"}
                  </span>
                  <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                    Si pas de réponse d'ici le {new Date(e.dueAt).toLocaleDateString()}
                  </span>
                </button>
                <Tooltip content="Retirer le rappel">
                  <Button
                    size="sm"
                    variant="ghost"
                    isIconOnly
                    aria-label="Retirer le rappel"
                    className="h-8 min-h-8 w-8 min-w-8"
                    onPress={() => {
                      removeFollowup(e.threadId);
                      toast({ title: "Rappel retiré" });
                    }}
                  >
                    <X size={14} />
                  </Button>
                </Tooltip>
              </div>
            ))}
          </div>
        </Popover.Dialog>
      </Popover.Content>
    </Popover>
  );
}
