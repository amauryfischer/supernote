"use client";

import { Button, Checkbox } from "@heroui/react";
import { Tag, Star } from "@phosphor-icons/react";
import { rowHasUnread, rowHasStar, rowUnreadCount, type OverlayRow } from "@/lib/mail-overlay";
import { rowCheckState } from "@/lib/mail-selection";
import type { GmailLabelColor } from "@/lib/gmail";

function shortDate(d: string): string {
  return d ? new Date(d).toLocaleDateString(undefined, { day: "2-digit", month: "short" }) : "";
}

export function MailOverlayList({
  rows,
  activeKey,
  onPick,
  onToggleStar,
  labelColors,
  selectedIndex,
  selectedThreadIds,
  onToggleRowSelection,
}: {
  rows: OverlayRow[];
  activeKey?: string;
  onPick: (row: OverlayRow) => void;
  /**
   * Toggle de l'étoile sur une ligne `single` (passe l'id du thread + ses
   * labelIds courants). Optimiste côté appelant ; ne déclenche PAS `onPick`.
   * Absent → pas d'étoile interactive (rétro-compatible).
   */
  onToggleStar?: (threadId: string, labelIds: string[]) => void;
  labelColors?: Map<string, GmailLabelColor>;
  /**
   * Index de la ligne sélectionnée au clavier (navigation j/k). Distinct de
   * `activeKey` (ligne réellement ouverte) : surligne la cible du curseur sans
   * forcément l'ouvrir. Le marqueur `data-mail-row-index` permet le scroll-into-view.
   */
  selectedIndex?: number;
  /**
   * Sélection multiple (desktop). Set des threadIds cochés. Quand fourni AVEC
   * `onToggleRowSelection`, chaque ligne affiche une Checkbox (état dérivé via
   * `rowCheckState` : un groupe partiellement coché est `indeterminate`).
   * Cocher un groupe coche tous ses threads. Absent → pas de sélection (mobile).
   */
  selectedThreadIds?: ReadonlySet<string>;
  /** Bascule la sélection de TOUS les threads d'une ligne (single ou groupe). */
  onToggleRowSelection?: (row: OverlayRow) => void;
}) {
  const selectable = Boolean(selectedThreadIds && onToggleRowSelection);
  // Au moins une coche → on garde toutes les cases visibles (mode sélection
  // assumé) ; sinon, chaque case n'apparaît qu'au survol de sa ligne (group-hover).
  const anySelected = (selectedThreadIds?.size ?? 0) > 0;
  return (
    <div className="flex flex-col gap-1" role="listbox" aria-label="Boîte mail">
      {rows.map((row, idx) => {
        const key = row.kind === "single" ? `t:${row.item.id}` : row.key;
        const title = row.kind === "single" ? row.item.from.name || row.item.from.email : row.title;
        const subject = row.kind === "single" ? row.item.subject : row.items[0]?.subject ?? "";
        const date = row.kind === "single" ? row.item.date : row.date;
        const isLabel = row.kind === "group" && row.groupType === "label";
        const labelId =
          row.kind === "group" && row.groupType === "label" && row.key.startsWith("label:")
            ? row.key.slice("label:".length)
            : null;
        const labelColor = labelId ? labelColors?.get(labelId) : undefined;
        const unread = rowHasUnread(row);
        const starred = rowHasStar(row);
        // Sous-compte non-lus d'un groupe : sert à grossir le badge de count et à
        // afficher un « N non lus » discret (0 → badge passif). Sur une ligne
        // `single` le point bleu suffit déjà ; on ne calcule ce détail que pour
        // les groupes (le badge de count n'existe que là).
        const groupUnread = row.kind === "group" ? rowUnreadCount(row) : 0;
        // Étoile interactive uniquement sur les lignes « single » (cible de toggle
        // non ambiguë). Pour un groupe, on n'affiche qu'un indicateur passif.
        const singleItem = row.kind === "single" ? row.item : null;
        const cursored = selectedIndex === idx;
        const checkState = selectable ? rowCheckState(row, selectedThreadIds!) : "unchecked";
        const rowButton = (
          <Button
            key={selectable ? undefined : key}
            data-mail-row-index={idx}
            variant={activeKey === key ? "primary" : "ghost"}
            onPress={() => onPick(row)}
            className={`h-auto w-full min-w-0 flex-1 justify-start whitespace-normal px-3 py-2 text-left${
              cursored && activeKey !== key
                ? " ring-2 ring-inset ring-[var(--accent)] ring-offset-0"
                : ""
            }`}
            aria-selected={cursored || activeKey === key}
          >
            <span className="flex w-full min-w-0 flex-col gap-0.5">
              <span className="flex items-baseline justify-between gap-2">
                <span className="flex min-w-0 items-center gap-1.5">
                  {unread && (
                    <span
                      aria-label="Non lu"
                      title="Non lu"
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{ backgroundColor: "var(--accent)" }}
                    />
                  )}
                  {isLabel ? (
                    <span
                      className={`inline-flex min-w-0 items-center gap-1 truncate rounded-full px-2 py-0.5 text-xs ${unread ? "font-bold" : "font-medium"}`}
                      style={
                        labelColor
                          ? { backgroundColor: labelColor.backgroundColor, color: labelColor.textColor }
                          : { backgroundColor: "var(--accent-subtle)", color: "var(--accent)" }
                      }
                    >
                      <Tag size={11} aria-hidden />
                      <span className="truncate">{title}</span>
                    </span>
                  ) : (
                    <span className={`truncate text-sm ${unread ? "font-bold" : "font-medium"}`}>{title}</span>
                  )}
                  {row.kind === "group" && (
                    <span
                      className={`shrink-0 rounded-full px-1.5 text-xs ${
                        groupUnread > 0 ? "font-bold" : ""
                      }`}
                      title={
                        groupUnread > 0
                          ? `${groupUnread} non lu${groupUnread > 1 ? "s" : ""} sur ${row.count}`
                          : `${row.count} fils`
                      }
                      style={{ background: "var(--accent-subtle)", color: "var(--accent)" }}
                    >
                      {groupUnread > 0 ? `${groupUnread}/${row.count}` : row.count}
                    </span>
                  )}
                </span>
                <span className="flex shrink-0 items-center gap-1">
                  {/* Étoile : native (interactive imbriquée dans la ligne-Button →
                      pas de Button HeroUI nesté). stopPropagation = ne pas ouvrir
                      le fil. Sur un groupe : indicateur passif non cliquable. */}
                  {singleItem && onToggleStar ? (
                    <span
                      role="button"
                      tabIndex={0}
                      aria-label={starred ? "Retirer l'étoile" : "Mettre une étoile"}
                      aria-pressed={starred}
                      className="inline-flex shrink-0 cursor-pointer p-0.5"
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggleStar(singleItem.id, singleItem.labelIds);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          e.stopPropagation();
                          onToggleStar(singleItem.id, singleItem.labelIds);
                        }
                      }}
                    >
                      <Star
                        size={14}
                        weight={starred ? "fill" : "regular"}
                        style={{ color: starred ? "#f5b300" : "var(--text-muted)" }}
                      />
                    </span>
                  ) : (
                    starred && (
                      <Star
                        size={14}
                        weight="fill"
                        aria-label="Contient un message étoilé"
                        style={{ color: "#f5b300" }}
                      />
                    )
                  )}
                  <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                    {shortDate(date)}
                  </span>
                </span>
              </span>
              <span className="truncate text-sm" style={{ color: "var(--text-secondary)" }}>
                {subject}
              </span>
            </span>
          </Button>
        );
        if (!selectable) return rowButton;
        // Mode sélection : la Checkbox vit À CÔTÉ de la ligne-Button (jamais
        // imbriquée — un control interactif dans un Button serait invalide). On
        // déplace la `key` sur le wrapper. La case n'apparaît qu'au survol de la
        // ligne (`group`/`group-hover`) tant qu'aucune sélection n'est active ;
        // dès qu'une case est cochée OU que la ligne est cochée, on la garde
        // visible (focus-within → accès clavier). Hit-target tactile ≥32px.
        const showBox = anySelected || checkState !== "unchecked";
        return (
          <div key={key} className="group flex items-center gap-1">
            <Checkbox
              isSelected={checkState === "checked"}
              isIndeterminate={checkState === "indeterminate"}
              onChange={() => onToggleRowSelection!(row)}
              className={`shrink-0 pl-1 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 ${
                showBox ? "opacity-100" : "opacity-0"
              }`}
              aria-label={
                checkState === "checked" ? "Désélectionner cette ligne" : "Sélectionner cette ligne"
              }
            />
            {rowButton}
          </div>
        );
      })}
    </div>
  );
}
