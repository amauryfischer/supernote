"use client";

/**
 * MailSnoozedBadge — fils reportés, consultables avant leur retour.
 *
 * Un fil reporté quitte la boîte ET le mirror : sans cette liste, rien ne
 * rappelle qu'il existe avant l'échéance.
 */

import { useEffect, useState } from "react";
import { Button, Popover } from "@heroui/react";
import { ArrowUUpLeft, Clock } from "@phosphor-icons/react";
import { Tooltip, useToast } from "@supernote/ui";
import { modifyThreadLabels } from "@/lib/gmail";
import { INBOX_LABEL, loadSnoozed, removeSnooze, MAIL_SNOOZE_EVENT, type SnoozeEntry } from "@/lib/mail-triage";

const UNTIL_FORMAT: Intl.DateTimeFormatOptions = {
  weekday: "short",
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
};

export function MailSnoozedBadge({
  clientId,
  onOpenThread,
}: {
  clientId: string;
  onOpenThread?: (id: string) => void;
}) {
  const { toast } = useToast();
  const [entries, setEntries] = useState<SnoozeEntry[]>(() => loadSnoozed());
  const [open, setOpen] = useState(false);
  const [waking, setWaking] = useState<string | null>(null);

  useEffect(() => {
    const refresh = () => setEntries(loadSnoozed());
    window.addEventListener(MAIL_SNOOZE_EVENT, refresh);
    return () => window.removeEventListener(MAIL_SNOOZE_EVENT, refresh);
  }, []);

  if (entries.length === 0) return null;
  const sorted = [...entries].sort((a, b) => a.until - b.until);

  const wake = (e: SnoozeEntry) => {
    setWaking(e.threadId);
    modifyThreadLabels(clientId, e.threadId, { addLabelIds: [INBOX_LABEL] })
      .then(() => {
        removeSnooze(e.threadId);
        toast({ title: "Email remis dans la boîte", variant: "success" });
      })
      .catch((err: unknown) =>
        toast({
          title: "Réveil impossible",
          description: err instanceof Error ? err.message : String(err),
          variant: "danger",
        }),
      )
      .finally(() => setWaking(null));
  };

  const label = `${entries.length} email${entries.length > 1 ? "s" : ""} reporté${entries.length > 1 ? "s" : ""}`;
  return (
    <Popover isOpen={open} onOpenChange={setOpen}>
      <Tooltip content={label}>
        <Button variant="ghost" size="sm" aria-label={label}>
          <Clock size={16} aria-hidden />
          <span className="ml-1 text-xs">{entries.length}</span>
        </Button>
      </Tooltip>
      <Popover.Content className="w-80 max-w-[calc(100vw-2rem)] p-1">
        <Popover.Dialog className="outline-none">
          <p className="px-2 pb-1 pt-1.5 text-xs font-medium" style={{ color: "var(--text-muted)" }}>
            Reportés
          </p>
          <div className="flex max-h-80 flex-col gap-0.5 overflow-y-auto">
            {sorted.map((e) => (
              <div key={e.threadId} className="flex items-center gap-1.5 rounded-md p-1">
                <Button
                  variant="ghost"
                  className="h-auto min-w-0 flex-1 flex-col items-start gap-0 px-2 py-1.5 text-left"
                  onPress={() => {
                    setOpen(false);
                    onOpenThread?.(e.threadId);
                  }}
                >
                  <span className="w-full truncate text-sm font-medium" style={{ color: "var(--text-primary)" }}>
                    {e.subject || "(sans objet)"}
                  </span>
                  <span className="w-full truncate text-xs font-normal" style={{ color: "var(--text-muted)" }}>
                    {e.from ? `${e.from} · ` : ""}revient {new Date(e.until).toLocaleString(undefined, UNTIL_FORMAT)}
                  </span>
                </Button>
                <Tooltip content="Remettre dans la boîte maintenant">
                  <Button
                    size="sm"
                    variant="ghost"
                    isIconOnly
                    aria-label="Remettre dans la boîte maintenant"
                    className="h-8 min-h-8 w-8 min-w-8 shrink-0"
                    isDisabled={waking === e.threadId}
                    onPress={() => wake(e)}
                  >
                    <ArrowUUpLeft size={14} />
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
