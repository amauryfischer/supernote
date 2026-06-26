"use client";

import { useEffect, useRef, useState } from "react";
import { Button, Checkbox } from "@heroui/react";
import { Tag, Star } from "@phosphor-icons/react";
import { rowHasUnread, rowHasStar, rowUnreadCount, type OverlayRow } from "@/lib/mail-overlay";
import { rowCheckState } from "@/lib/mail-selection";
import { QUADRANTS, type EisenhowerQuadrant } from "@/lib/mail-eisenhower";
import { SNOOZE_PRESETS, type TriageAction } from "@/lib/mail-triage";
import type { GmailLabelColor } from "@/lib/gmail";
import { initials, avatarColor } from "@/lib/mail-avatar";
import { formatMailDate } from "@/lib/mail-date";

export function MailOverlayList({
  rows,
  activeKey,
  onPick,
  onToggleStar,
  labelColors,
  selectedIndex,
  selectedThreadIds,
  onToggleRowSelection,
  onConvertRowToTodo,
  onTriageRow,
  onMarkRowRead,
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
  /** Clic droit : convertir une ligne single en tâche Eisenhower. */
  onConvertRowToTodo?: (row: OverlayRow, quadrant: EisenhowerQuadrant) => void;
  /** Clic droit : triage rapide d'une ligne single (`until` = échéance snooze). */
  onTriageRow?: (row: OverlayRow, action: TriageAction, until?: number) => void;
  /** Clic droit : marquer lu/non-lu une ligne single. */
  onMarkRowRead?: (row: OverlayRow, read: boolean) => void;
}) {
  const selectable = Boolean(selectedThreadIds && onToggleRowSelection);
  // Au moins une coche → on garde toutes les cases visibles (mode sélection
  // assumé) ; sinon, chaque case n'apparaît qu'au survol de sa ligne (group-hover).
  const anySelected = (selectedThreadIds?.size ?? 0) > 0;
  const [ctx, setCtx] = useState<{ x: number; y: number; row: OverlayRow } | null>(null);
  return (
    <>
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
        // Monogramme + aperçu : expéditeur (single / groupe sender) et 1ʳᵉ ligne
        // de snippet. Couleur déterministe sobre dérivée de l'email/nom.
        const fromAddr =
          singleItem?.from ??
          (row.kind === "group" && row.groupType === "sender" ? row.items[0]?.from : undefined);
        const preview =
          row.kind === "single" ? row.item.snippet : row.kind === "group" ? row.items[0]?.snippet ?? "" : "";
        const avatar = avatarColor(fromAddr?.email || fromAddr?.name || title);
        const mono = initials(fromAddr?.name ?? "", fromAddr?.email ?? title);
        const rowButton = (
          <Button
            data-mail-row-index={idx}
            variant="ghost"
            onPress={() => onPick(row)}
            className={`h-auto w-full min-w-0 flex-1 justify-start whitespace-normal rounded-lg px-2.5 py-2.5 text-left${
              cursored && activeKey !== key
                ? " ring-2 ring-inset ring-[var(--accent)] ring-offset-0"
                : ""
            }`}
            // Ligne ouverte : surlignage SOBRE (accent-subtle + barre accent à
            // gauche), cohérent avec l'item actif de la sidebar — pas un bloc
            // violet plein.
            style={
              activeKey === key
                ? { backgroundColor: "var(--accent-subtle)", boxShadow: "inset 3px 0 0 0 var(--accent)" }
                : undefined
            }
            aria-selected={cursored || activeKey === key}
          >
            <span className="flex w-full min-w-0 items-start gap-2.5">
              {/* Monogramme expéditeur (signature visuelle) : tuile de label
                  colorée, ou initiales sur fond déterministe sobre. Pastille
                  non-lu en surimpression coin haut-gauche. */}
              <span className="relative shrink-0">
                <span
                  aria-hidden
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-xs font-semibold"
                  style={
                    isLabel
                      ? {
                          backgroundColor: labelColor?.backgroundColor ?? "var(--accent-subtle)",
                          color: labelColor?.textColor ?? "var(--accent)",
                        }
                      : { backgroundColor: avatar.bg, color: avatar.fg }
                  }
                >
                  {isLabel ? <Tag size={14} /> : mono}
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

              {/* Colonne texte : expéditeur · objet · aperçu (toutes tronquées). */}
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="flex min-w-0 items-center gap-1.5">
                  <span
                    className={`truncate text-sm ${unread ? "font-semibold" : "font-medium"}`}
                    style={{ color: "var(--text-primary)" }}
                  >
                    {title}
                  </span>
                  {row.kind === "group" && (
                    <span
                      className={`shrink-0 rounded-full px-1.5 text-xs ${groupUnread > 0 ? "font-bold" : ""}`}
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
                <span className="truncate text-[13px]" style={{ color: "var(--text-secondary)" }}>
                  {subject}
                </span>
                {preview && (
                  <span className="truncate text-xs" style={{ color: "var(--text-muted)" }}>
                    {preview}
                  </span>
                )}
              </span>

              {/* Méta droite : date + étoile. */}
              <span className="flex shrink-0 flex-col items-end gap-1">
                <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                  {formatMailDate(date)}
                </span>
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
              </span>
            </span>
          </Button>
        );
        // Toute ligne est enveloppée pour porter le clic droit (menu contextuel)
        // et, en mode sélection, la Checkbox à côté du Button (jamais imbriquée —
        // un control interactif dans un Button serait invalide). La case n'apparaît
        // qu'au survol tant qu'aucune sélection n'est active ; visible dès qu'une
        // case (ou la ligne) est cochée. Hit-target tactile ≥32px.
        const showBox = selectable && (anySelected || checkState !== "unchecked");
        return (
          <div
            key={key}
            className={`flex items-center gap-1${selectable ? " group" : ""}`}
            onContextMenu={(e) => {
              e.preventDefault();
              setCtx({ x: e.clientX, y: e.clientY, row });
            }}
          >
            {selectable && (
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
            )}
            {rowButton}
          </div>
        );
      })}
      </div>
      {ctx && (
        <MailRowContextMenu
          x={ctx.x}
          y={ctx.y}
          row={ctx.row}
          onClose={() => setCtx(null)}
          onPick={onPick}
          onToggleStar={onToggleStar}
          onConvert={onConvertRowToTodo}
          onTriage={onTriageRow}
          onMarkRead={onMarkRowRead}
        />
      )}
    </>
  );
}

/**
 * Menu contextuel (clic droit) d'une ligne de la boîte mail. Positionné en fixe
 * au curseur, fermé au clic-extérieur / Échap. Actions selon `row.kind` : une
 * ligne `single` propose ouvrir / étoile / lu-non lu / → Todo (4 quadrants) /
 * triage (Fait/Archiver/Reporter/Supprimer) ; un groupe → « Ouvrir ».
 */
function MailRowContextMenu({
  x,
  y,
  row,
  onClose,
  onPick,
  onToggleStar,
  onConvert,
  onTriage,
  onMarkRead,
}: {
  x: number;
  y: number;
  row: OverlayRow;
  onClose: () => void;
  onPick: (row: OverlayRow) => void;
  onToggleStar?: (threadId: string, labelIds: string[]) => void;
  onConvert?: (row: OverlayRow, quadrant: EisenhowerQuadrant) => void;
  onTriage?: (row: OverlayRow, action: TriageAction, until?: number) => void;
  onMarkRead?: (row: OverlayRow, read: boolean) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    const id = window.setTimeout(() => document.addEventListener("mousedown", onDown), 0);
    document.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(id);
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const single = row.kind === "single" ? row.item : null;
  const unread = rowHasUnread(row);
  const starred = rowHasStar(row);
  const run = (fn: () => void) => {
    fn();
    onClose();
  };

  const W = 230;
  const left = Math.min(x, window.innerWidth - W - 8);
  const top = Math.min(y, Math.max(8, window.innerHeight - 380));

  return (
    <div
      ref={ref}
      role="menu"
      className="fixed z-50 flex w-[230px] flex-col gap-0.5 rounded-lg p-1 shadow-xl"
      style={{ left, top, backgroundColor: "var(--surface-1)", border: "1px solid var(--border-subtle)" }}
    >
      <CtxItem label="Ouvrir" onClick={() => run(() => onPick(row))} />
      {single && onToggleStar && (
        <CtxItem
          label={starred ? "Retirer l'étoile" : "Mettre une étoile"}
          onClick={() => run(() => onToggleStar(single.id, single.labelIds))}
        />
      )}
      {single && onMarkRead && (
        <CtxItem
          label={unread ? "Marquer comme lu" : "Marquer comme non lu"}
          onClick={() => run(() => onMarkRead(row, unread))}
        />
      )}
      {single && onConvert && (
        <>
          <CtxSep />
          <CtxLabel text="Convertir en tâche" />
          {QUADRANTS.map((q) => (
            <CtxItem key={q.id} label={q.label} indent onClick={() => run(() => onConvert(row, q.id))} />
          ))}
        </>
      )}
      {single && onTriage && (
        <>
          <CtxSep />
          <CtxItem label="Fait" onClick={() => run(() => onTriage(row, "done"))} />
          <CtxItem label="Archiver" onClick={() => run(() => onTriage(row, "archive"))} />
          <CtxLabel text="Reporter" />
          {SNOOZE_PRESETS.map((p) => (
            <CtxItem
              key={p.id}
              label={p.label}
              indent
              onClick={() => run(() => onTriage(row, "snooze", p.computeUntil(new Date())))}
            />
          ))}
          <CtxSep />
          <CtxItem label="Supprimer" danger onClick={() => run(() => onTriage(row, "delete"))} />
        </>
      )}
    </div>
  );
}

function CtxItem({
  label,
  onClick,
  danger,
  indent,
}: {
  label: string;
  onClick: () => void;
  danger?: boolean;
  indent?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={`w-full rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-[var(--surface-2)] ${indent ? "pl-4" : ""}`}
      style={{ color: danger ? "var(--color-danger, #ef4444)" : "var(--text-primary)" }}
    >
      {label}
    </button>
  );
}

function CtxSep() {
  return <div className="my-0.5 h-px" style={{ backgroundColor: "var(--border-subtle)" }} />;
}

function CtxLabel({ text }: { text: string }) {
  return (
    <div
      className="px-2 pt-1 text-[11px] font-medium uppercase tracking-wide"
      style={{ color: "var(--text-muted)" }}
    >
      {text}
    </div>
  );
}
