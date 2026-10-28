"use client";

import { useMemo, type ComponentProps } from "react";
import { Tooltip, Button } from "@supernote/ui";
import { Trash, EnvelopeOpen } from "@phosphor-icons/react";
import type { ThreadListItem } from "@/lib/gmail";
import type { OverlayRow } from "@/lib/mail-overlay";
import { MailOverlayList } from "./MailOverlayList";

type ListProps = ComponentProps<typeof MailOverlayList>;

/** Volet d'un groupe : en-tête (actions de groupe) + les mêmes lignes que la boîte principale. */
export function MailGroupList({
  title,
  items,
  activeThreadId,
  cursorIndex,
  onPick,
  onDeleteAll,
  onMarkAllRead,
  deleteBusy,
  groupLabelId,
  ...list
}: {
  title: string;
  items: ThreadListItem[];
  activeThreadId?: string;
  /** Index de la ligne « curseur » de la nav clavier (distinct de l'ouverte). */
  cursorIndex?: number;
  onPick: (threadId: string) => void;
  /** Présent → affiche un bouton « tout supprimer » dans l'en-tête du groupe. */
  onDeleteAll?: () => void;
  /** Présent → affiche « tout marquer comme lu » (si ≥1 non lu). */
  onMarkAllRead?: () => void;
  deleteBusy?: boolean;
  /** Label du groupe ouvert : commun à toutes les lignes, donc pas répété en pastille. */
  groupLabelId?: string;
} & Omit<ListProps, "rows" | "activeKey" | "selectedIndex" | "onPick" | "indexAttr" | "hideLabelId" | "sections">) {
  const rows = useMemo<OverlayRow[]>(() => items.map((item) => ({ kind: "single", item })), [items]);
  const unreadCount = items.filter((it) => it.labelIds.includes("UNREAD")).length;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-2 px-3 py-1">
        <p className="sn-eyebrow sn-eyebrow--compact">
          {title} · {items.length}
        </p>
        <div className="flex shrink-0 items-center gap-0.5">
          {onMarkAllRead && unreadCount > 0 && (
            <Tooltip content="Tout marquer comme lu">
              <Button size="icon" variant="ghost" aria-label="Tout marquer comme lu" onPress={onMarkAllRead}>
                <EnvelopeOpen size={16} />
              </Button>
            </Tooltip>
          )}
          {onDeleteAll && items.length > 0 && (
            <Tooltip content="Supprimer tout le groupe">
              <Button
                size="icon"
                variant="ghost"
                aria-label="Supprimer tout le groupe"
                isDisabled={deleteBusy}
                onPress={onDeleteAll}
              >
                <Trash size={16} />
              </Button>
            </Tooltip>
          )}
        </div>
      </div>
      <MailOverlayList
        {...list}
        rows={rows}
        activeKey={activeThreadId ? `t:${activeThreadId}` : undefined}
        selectedIndex={cursorIndex}
        onPick={(row) => row.kind === "single" && onPick(row.item.id)}
        indexAttr="data-mail-group-index"
        hideLabelId={groupLabelId}
      />
    </div>
  );
}
