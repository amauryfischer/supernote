"use client";

import { Button, Checkbox } from "@heroui/react";
import { Tooltip } from "@supernote/ui";
import { Trash, EnvelopeOpen, Sparkle, Star } from "@phosphor-icons/react";
import type { GmailLabelColor, ThreadListItem } from "@/lib/gmail";
import { RowLabelChips } from "./LabelMarker";
import { formatMailDateTime } from "@/lib/mail-date";
import { initials, avatarColor } from "@/lib/mail-avatar";
import { SwipeableRow, type SwipeAction } from "./SwipeableRow";

export function MailGroupList({
  title,
  items,
  activeThreadId,
  cursorIndex,
  onPick,
  onDeleteAll,
  onMarkAllRead,
  deleteBusy,
  summaries,
  labelNames,
  labelColors,
  groupLabelId,
  onToggleStar,
  onSwipe,
  onLongPress,
  selectedIds,
  onToggleSelect,
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
  /** threadId → mini-résumé IA, affiché sous l'objet (cf. MailOverlayList). */
  summaries?: ReadonlyMap<string, string>;
  labelNames?: ReadonlyMap<string, string>;
  labelColors?: ReadonlyMap<string, GmailLabelColor>;
  /** Label du groupe ouvert : commun à toutes les lignes, donc pas répété en pastille. */
  groupLabelId?: string;
  onToggleStar?: (threadId: string, labelIds: string[]) => void;
  /** Présent → gestes tactiles sur chaque ligne (parité MailOverlayList). */
  onSwipe?: (threadId: string, action: SwipeAction) => void;
  onLongPress?: (item: ThreadListItem) => void;
  /** Présent → cases à cocher (sélection multiple, cf. MailOverlayList). */
  selectedIds?: ReadonlySet<string>;
  onToggleSelect?: (threadId: string) => void;
}) {
  const anySelected = items.some((it) => selectedIds?.has(it.id));
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
              <Button
                size="sm"
                variant="ghost"
                isIconOnly
                aria-label="Tout marquer comme lu"
                onPress={onMarkAllRead}
              >
                <EnvelopeOpen size={16} />
              </Button>
            </Tooltip>
          )}
          {onDeleteAll && items.length > 0 && (
            <Tooltip content="Supprimer tout le groupe">
              <Button
                size="sm"
                variant="ghost"
                isIconOnly
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
      {items.map((it, idx) => {
        const active = activeThreadId === it.id;
        const cursored = cursorIndex === idx;
        const unread = it.labelIds.includes("UNREAD");
        const avatar = avatarColor(it.from.email || it.from.name || title);
        const mono = initials(it.from.name ?? "", it.from.email ?? "");
        const aiSummary = summaries?.get(it.id);
        const starred = it.labelIds.includes("STARRED");
        const row = (
          <Button
            key={it.id}
            data-mail-group-index={idx}
            variant="ghost"
            onPress={() => onPick(it.id)}
            aria-selected={active || cursored}
            // Curseur clavier (non ouvert) = anneau accent ; ouvert = accent-subtle
            // + barre à gauche (cohérent avec MailOverlayList).
            className={`h-auto w-full justify-start whitespace-normal rounded-lg px-3 py-2 text-left${
              cursored && !active ? " ring-2 ring-inset ring-[var(--accent)]" : ""
            }`}
            style={
              active
                ? { backgroundColor: "var(--accent-subtle)", boxShadow: "inset 3px 0 0 0 var(--accent)" }
                : undefined
            }
          >
            <span className="flex w-full min-w-0 items-start gap-2.5">
              {/* Monogramme expéditeur + pastille non-lu (parité MailOverlayList) :
                  repère visuel + scan rapide des fils non lus dans un groupe. */}
              <span className="relative shrink-0">
                <span
                  aria-hidden
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-xs font-semibold"
                  style={{ backgroundColor: avatar.bg, color: avatar.fg }}
                >
                  {mono}
                </span>
                {unread && (
                  <span
                    aria-label="Non lu"
                    title="Non lu"
                    className="absolute -left-1 -top-1 h-2.5 w-2.5 rounded-full"
                    style={{ backgroundColor: "var(--accent)", boxShadow: "0 0 0 2px var(--surface-0)" }}
                  />
                )}
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="flex items-baseline justify-between gap-2">
                  <span
                    className={`truncate text-sm ${unread ? "font-semibold" : "font-medium"}`}
                    style={{ color: "var(--text-primary)" }}
                  >
                    {it.from.name || it.from.email}
                  </span>
                  <span className="flex shrink-0 items-center gap-1.5">
                    {/* Natif : interactif imbriqué dans la ligne-Button (cf. MailOverlayList). */}
                    {onToggleStar && (
                      <span
                        role="button"
                        tabIndex={0}
                        aria-label={starred ? "Retirer l'étoile" : "Mettre une étoile"}
                        aria-pressed={starred}
                        className="inline-flex shrink-0 cursor-pointer p-0.5"
                        onClick={(e) => {
                          e.stopPropagation();
                          onToggleStar(it.id, it.labelIds);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            e.stopPropagation();
                            onToggleStar(it.id, it.labelIds);
                          }
                        }}
                      >
                        <Star
                          size={14}
                          weight={starred ? "fill" : "regular"}
                          style={{ color: starred ? "#f5b300" : "var(--text-muted)" }}
                        />
                      </span>
                    )}
                    <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                      {formatMailDateTime(it.date)}
                    </span>
                  </span>
                </span>
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className="min-w-0 flex-1 truncate text-sm" style={{ color: "var(--text-secondary)" }}>
                    {it.subject}
                  </span>
                  <RowLabelChips
                    labelIds={it.labelIds.filter((id) => id !== groupLabelId)}
                    names={labelNames}
                    colors={labelColors}
                  />
                </span>
                {aiSummary && (
                  <span
                    className="flex min-w-0 items-start gap-1 text-xs"
                    style={{ color: "var(--text-muted)" }}
                    title="Résumé par l'IA locale"
                  >
                    <Sparkle
                      size={11}
                      weight="fill"
                      aria-hidden
                      className="mt-0.5 shrink-0"
                      style={{ color: "var(--accent)" }}
                    />
                    <span className="line-clamp-2 min-w-0">{aiSummary}</span>
                  </span>
                )}
              </span>
            </span>
          </Button>
        );
        const checked = selectedIds?.has(it.id) ?? false;
        // Case hors du Button (jamais imbriquée) ; visible au survol, ou dès qu'une ligne est cochée.
        const body = onToggleSelect ? (
          <div key={it.id} className="group flex items-center gap-1">
            <Checkbox
              isSelected={checked}
              onChange={() => onToggleSelect(it.id)}
              className={`shrink-0 pl-1 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 ${
                anySelected || checked ? "opacity-100" : "opacity-0"
              }`}
              aria-label={checked ? "Désélectionner cet email" : "Sélectionner cet email"}
            />
            <div className="min-w-0 flex-1">{row}</div>
          </div>
        ) : (
          row
        );
        if (!onSwipe) return body;
        return (
          <SwipeableRow
            key={it.id}
            onSwipe={(action) => onSwipe(it.id, action)}
            {...(onLongPress ? { onLongPress: () => onLongPress(it) } : {})}
          >
            {body}
          </SwipeableRow>
        );
      })}
    </div>
  );
}
