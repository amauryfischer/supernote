"use client";

/**
 * MailRowSheet — feuille d'actions d'un email sur mobile (appui long).
 *
 * Équivalent tactile du menu contextuel (clic droit) du desktop : sans elle,
 * tout ce qui n'est pas « ouvrir » exigeait d'entrer dans le fil. Les cibles
 * font 44 px de haut (pouce), et les actions destructives sont isolées en bas.
 */

import { Button } from "@heroui/react";
import { MobileSheet } from "@/components/shell";
import {
  Archive,
  CheckCircle,
  Clock,
  Trash,
  Envelope,
  EnvelopeOpen,
  Star,
  ArrowSquareOut,
  SpeakerSlash,
} from "@phosphor-icons/react";
import type { TriageAction } from "@/lib/mail-triage";
import type { ThreadListItem } from "@/lib/gmail";

export interface MailRowSheetProps {
  item: ThreadListItem | null;
  onClose: () => void;
  onOpen: (threadId: string) => void;
  onTriage: (threadId: string, action: TriageAction) => void;
  onSnoozeMenu: (threadId: string, subject: string) => void;
  onToggleStar: (threadId: string, labelIds: string[]) => void;
  onMarkRead: (item: ThreadListItem, read: boolean) => void;
  onMute: (threadId: string) => void;
}

/** Ligne d'action de la feuille (cible tactile 44 px). */
function SheetAction({
  icon,
  label,
  onPress,
  danger = false,
}: {
  icon: React.ReactNode;
  label: string;
  onPress: () => void;
  danger?: boolean;
}) {
  return (
    <Button
      variant="ghost"
      className="h-11 w-full justify-start gap-3 px-3 text-sm"
      style={danger ? { color: "var(--color-danger, #ef4444)" } : undefined}
      onPress={onPress}
    >
      {icon}
      {label}
    </Button>
  );
}

export function MailRowSheet({
  item,
  onClose,
  onOpen,
  onTriage,
  onSnoozeMenu,
  onToggleStar,
  onMarkRead,
  onMute,
}: MailRowSheetProps) {
  const unread = item?.labelIds.includes("UNREAD") ?? false;
  const starred = item?.labelIds.includes("STARRED") ?? false;

  const run = (fn: () => void) => () => {
    fn();
    onClose();
  };

  return (
    <MobileSheet
      isOpen={item !== null}
      onClose={onClose}
      title={item?.subject || "Email"}
      size="md"
    >
      {item && (
        <div className="flex flex-col gap-0.5 px-2 pb-4">
          <p className="px-3 pb-2 text-xs" style={{ color: "var(--text-muted)" }}>
            {item.from.name || item.from.email}
          </p>
          <SheetAction
            icon={<ArrowSquareOut size={18} />}
            label="Ouvrir"
            onPress={run(() => onOpen(item.id))}
          />
          <SheetAction
            icon={<CheckCircle size={18} />}
            label="Marquer comme fait"
            onPress={run(() => onTriage(item.id, "done"))}
          />
          <SheetAction
            icon={<Archive size={18} />}
            label="Archiver"
            onPress={run(() => onTriage(item.id, "archive"))}
          />
          <SheetAction
            icon={<Clock size={18} />}
            label="Reporter à…"
            onPress={run(() => onSnoozeMenu(item.id, item.subject))}
          />
          <SheetAction
            icon={unread ? <EnvelopeOpen size={18} /> : <Envelope size={18} />}
            label={unread ? "Marquer comme lu" : "Marquer comme non lu"}
            onPress={run(() => onMarkRead(item, unread))}
          />
          <SheetAction
            icon={<Star size={18} weight={starred ? "fill" : "regular"} />}
            label={starred ? "Retirer l'étoile" : "Mettre une étoile"}
            onPress={run(() => onToggleStar(item.id, item.labelIds))}
          />
          <SheetAction
            icon={<SpeakerSlash size={18} />}
            label="Ignorer ce fil"
            onPress={run(() => onMute(item.id))}
          />
          <div className="my-1 h-px" style={{ background: "var(--border-subtle)" }} />
          <SheetAction
            icon={<Trash size={18} />}
            label="Supprimer"
            danger
            onPress={run(() => onTriage(item.id, "delete"))}
          />
        </div>
      )}
    </MobileSheet>
  );
}
