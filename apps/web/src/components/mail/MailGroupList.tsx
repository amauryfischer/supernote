"use client";

import { Tooltip, Checkbox, Button } from "@supernote/ui";
import { Trash, EnvelopeOpen, Sparkle, Star } from "@phosphor-icons/react";
import type { GmailLabelColor, ThreadListItem } from "@/lib/gmail";
import { RowLabelChips } from "./LabelMarker";
import { formatMailDateTime } from "@/lib/mail-date";
import { awaitsMyReply, isSelfAddress } from "@/lib/mail-awaiting";

// Label nommé d'après une boîte (alias de réception) : pas un tag.
const EMAIL_LIKE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const NO_SELF: readonly string[] = [];
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
  selfEmails = NO_SELF,
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
  selfEmails?: readonly string[];
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
                size="icon"
                variant="ghost"
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
      {items.map((it, idx) => {
        const active = activeThreadId === it.id;
        const cursored = cursorIndex === idx;
        const unread = it.labelIds.includes("UNREAD");
        const awaiting = awaitsMyReply(it, selfEmails);
        const mine = isSelfAddress(it.from.email, selfEmails);
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
            className="h-auto min-h-0 w-full justify-start whitespace-normal rounded-none border-b px-3 py-2 text-left"
            style={{
              borderColor: "var(--border-subtle)",
              ...(active
                ? { backgroundColor: "var(--accent-subtle)", boxShadow: "inset 2px 0 0 0 var(--accent)" }
                : cursored
                  ? { backgroundColor: "var(--surface-2, var(--accent-subtle))", boxShadow: "inset 2px 0 0 0 var(--text-muted)" }
                  : awaiting
                    ? { boxShadow: "inset 2px 0 0 0 oklch(0.72 0.17 50)" }
                    : {}),
            }}
          >
            <span className="flex w-full min-w-0 items-start gap-2.5">
              <span className="flex h-5 w-2.5 shrink-0 items-center justify-center" aria-hidden>
                {awaiting ? (
                  <span className="sn-ember" />
                ) : unread ? (
                  <span className="h-1.5 w-1.5 rounded-full" style={{ background: "var(--accent)" }} />
                ) : null}
              </span>
              {(unread || awaiting) && (
                <span className="sr-only">{[unread && "Non lu", awaiting && "À toi de répondre"].filter(Boolean).join(", ")}</span>
              )}
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="flex items-baseline justify-between gap-2">
                  <span
                    className={`truncate text-[13px] ${unread ? "font-semibold" : "font-medium"}`}
                    style={{ color: mine ? "var(--text-muted)" : "var(--text-primary)" }}
                    title={it.from.email}
                  >
                    {mine ? "Moi ↗" : it.from.name || it.from.email}
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
                          style={{ color: starred ? "var(--text-primary)" : "var(--text-muted)" }}
                        />
                      </span>
                    )}
                    <span
                      className="font-mono text-[11px] tabular-nums"
                      style={{ color: awaiting ? "oklch(0.72 0.17 50)" : "var(--text-muted)" }}
                    >
                      {formatMailDateTime(it.date)}
                    </span>
                  </span>
                </span>
                <span className="flex min-w-0 items-center gap-1.5">
                  <span
                    className={`min-w-0 truncate text-[13px] ${unread ? "font-semibold" : ""}`}
                    style={{ color: unread || awaiting ? "var(--text-primary)" : "var(--text-secondary)" }}
                  >
                    {it.subject}
                  </span>
                  <RowLabelChips
                    labelIds={it.labelIds.filter((id) => id !== groupLabelId && !EMAIL_LIKE.test(labelNames?.get(id) ?? ""))}
                    names={labelNames}
                    colors={labelColors}
                  />
                </span>
                {aiSummary && (
                  <span
                    className="flex min-w-0 items-start gap-1.5 text-[12px] leading-snug"
                    style={{ color: "var(--text-secondary)" }}
                    title={`Résumé par l'IA locale : ${aiSummary}`}
                  >
                    <Sparkle size={10} weight="fill" aria-hidden className="mt-[3px] shrink-0" style={{ color: "var(--text-muted)" }} />
                    <span className={`min-w-0 ${active || cursored ? "line-clamp-2" : "truncate"}`}>{aiSummary}</span>
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
