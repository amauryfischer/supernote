"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Button, Checkbox } from "@heroui/react";
import { Tag, Star, DotsSixVertical, Sparkle, CaretDown, Checks } from "@phosphor-icons/react";
import {
  DndContext,
  useDraggable,
  useDroppable,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  closestCenter,
  type DragEndEvent,
} from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import {
  rowHasUnread,
  rowHasStar,
  rowUnreadCount,
  distinctSenders,
  type OverlayRow,
} from "@/lib/mail-overlay";
import type { MailSectionId, MailSectionMarker } from "@/lib/mail-sections";
import { rowCheckState } from "@/lib/mail-selection";
import { QUADRANTS, type EisenhowerQuadrant } from "@/lib/mail-eisenhower";
import { SNOOZE_PRESETS, type TriageAction } from "@/lib/mail-triage";
import type { GmailLabelColor } from "@/lib/gmail";
import { initials, avatarColor } from "@/lib/mail-avatar";
import { formatMailDate } from "@/lib/mail-date";
import { SwipeableRow, type SwipeAction } from "./SwipeableRow";

/** Données partagées par toutes les lignes — évite de threader une douzaine de
 *  props à travers `MailRow`. */
interface SharedRowProps {
  activeKey?: string;
  onPick: (row: OverlayRow) => void;
  onToggleStar?: (threadId: string, labelIds: string[]) => void;
  labelColors?: Map<string, GmailLabelColor>;
  selectedIndex?: number;
  selectedThreadIds?: ReadonlySet<string>;
  onToggleRowSelection?: (row: OverlayRow) => void;
  selectable: boolean;
  anySelected: boolean;
  /** Drag-vers-groupe actif (desktop). Quand faux, les lignes ne sont ni
   *  draggables ni droppables (et la liste défile normalement sur tactile). */
  dndEnabled: boolean;
  onOpenContext: (c: { x: number; y: number; row: OverlayRow }) => void;
  /** Densité d'affichage : `compact` = 1 ligne par fil, `confort` = 3 lignes. */
  density: MailDensity;
  /** Gestes tactiles (mobile) : glisser pour archiver / reporter. */
  onSwipeRow?: (row: OverlayRow, action: SwipeAction) => void;
  /** Appui long (mobile) : feuille d'actions de la ligne. */
  onLongPressRow?: (row: OverlayRow) => void;
  /** threadId → mini-résumé IA. Remplace le snippet Gmail quand il existe. */
  summaries?: ReadonlyMap<string, string>;
}

/** Densité d'affichage de la liste (préférence utilisateur, cf. réglages Gmail). */
export type MailDensity = "compact" | "confort";

/**
 * Au-delà de ce nombre de lignes, la liste est VIRTUALISÉE (seules les lignes
 * visibles sont montées). En dessous, rendu direct : le drag-vers-tag reste
 * pleinement fonctionnel (une cible de drop hors fenêtre ne serait pas montée),
 * et une boîte « inbox zero » tient largement sous ce seuil.
 */
const VIRTUALIZE_THRESHOLD = 60;

/** Hauteur estimée d'une ligne (avant mesure réelle) selon la densité. */
const ROW_ESTIMATE: Record<MailDensity, number> = { compact: 36, confort: 76 };

/** Hauteur estimée d'un en-tête de section (avant mesure réelle). */
const HEADER_ESTIMATE = 34;

/** Expéditeurs distincts montrés dans la pile d'avatars d'un groupe. */
const SENDER_STACK_MAX = 4;

/** Objets d'un groupe-tag montrés en aperçu sur sa ligne. */
const GROUP_SUBJECT_MAX = 3;

/**
 * Entrée rendue par la liste : un en-tête de section, ou une ligne avec son
 * index DANS `rows` (l'index que manipule la navigation clavier — insérer des
 * en-têtes ne doit pas décaler le curseur).
 */
type ListEntry =
  | { kind: "header"; marker: MailSectionMarker }
  | { kind: "row"; row: OverlayRow; idx: number };

/** Clé React stable d'une entrée (l'id du fil / du groupe, jamais l'index). */
function entryKey(entry: ListEntry | undefined, fallback: number): string | number {
  if (!entry) return fallback;
  if (entry.kind === "header") return `h:${entry.marker.id}`;
  return entry.row.kind === "single" ? `t:${entry.row.item.id}` : entry.row.key;
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
  onConvertRowToTodo,
  onTriageRow,
  onMarkRowRead,
  onApplyLabel,
  userLabels,
  density = "confort",
  scrollElementRef,
  onSwipeRow,
  onLongPressRow,
  summaries,
  sections,
  onToggleSection,
  onMarkSectionRead,
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
  /**
   * Applique un tag (labelId Gmail) à un thread. Quand fourni, active le
   * drag-vers-groupe (glisser une ligne single sur un groupe-tag) ET l'action
   * « Ajouter un tag » du menu contextuel. Absent (mobile) → ni l'un ni l'autre.
   */
  onApplyLabel?: (threadId: string, labelId: string) => void;
  /** Labels utilisateur (labelId → nom) pour le menu « Ajouter un tag ». */
  userLabels?: Map<string, string>;
  /** Densité d'affichage (préférence utilisateur). Défaut : confort. */
  density?: MailDensity;
  /**
   * Conteneur scrollable de la liste (détenu par la page). Requis pour la
   * virtualisation ; sans lui, la liste est rendue intégralement.
   */
  scrollElementRef?: RefObject<HTMLElement | null>;
  /**
   * Glissement tactile sur une ligne (mobile) : droite = archiver, gauche =
   * reporter. Absent → pas de geste (desktop).
   */
  onSwipeRow?: (row: OverlayRow, action: SwipeAction) => void;
  /** Appui long sur une ligne (mobile) → feuille d'actions. */
  onLongPressRow?: (row: OverlayRow) => void;
  /**
   * Mini-résumés générés par l'IA locale (threadId → ~30 mots). Quand un fil en
   * a un, il remplace le snippet Gmail sous l'objet — le snippet est le DÉBUT du
   * corps (salutation, en-tête de newsletter), le résumé dit ce que l'email veut.
   * Absent → comportement historique (snippet).
   */
  summaries?: ReadonlyMap<string, string>;
  /**
   * En-têtes de section à insérer dans la liste (cf. `mail-sections`). Chaque
   * marqueur dit AVANT quelle ligne se poser ; `rows` est déjà dans l'ordre
   * d'affichage, sections repliées exclues. Absent → liste plate (historique).
   */
  sections?: readonly MailSectionMarker[];
  /** Replie / déplie une section. */
  onToggleSection?: (id: MailSectionId) => void;
  /** « Tout marquer lu » sur une section (ids des fils non lus). */
  onMarkSectionRead?: (threadIds: string[]) => void;
}) {
  const selectable = Boolean(selectedThreadIds && onToggleRowSelection);
  // Au moins une coche → on garde toutes les cases visibles (mode sélection
  // assumé) ; sinon, chaque case n'apparaît qu'au survol de sa ligne (group-hover).
  const anySelected = (selectedThreadIds?.size ?? 0) > 0;
  const [ctx, setCtx] = useState<{ x: number; y: number; row: OverlayRow } | null>(null);
  const dndEnabled = Boolean(onApplyLabel);

  const sensors = useSensors(
    // distance 6px → un clic (ouvre le fil) ne déclenche pas un drag ; au-delà,
    // c'est un glisser.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor),
  );

  // Drop d'une ligne single sur un groupe-tag → applique ce tag au thread.
  const handleDragEnd = (e: DragEndEvent) => {
    const a = e.active.data.current as
      | { type?: string; threadId?: string; labelIds?: string[] }
      | undefined;
    const o = e.over?.data.current as { type?: string; labelId?: string } | undefined;
    if (!a || !o || a.type !== "thread" || o.type !== "labelGroup") return;
    if (!a.threadId || !o.labelId) return;
    if (a.labelIds?.includes(o.labelId)) return; // déjà ce tag → no-op
    onApplyLabel?.(a.threadId, o.labelId);
  };

  // ── Entrées rendues (en-têtes + lignes) ───────────────────────────────────
  // Une seule liste plate : c'est elle que virtualise le rendu, et elle porte
  // l'index d'origine de chaque ligne pour que le curseur clavier reste juste.
  const entries = useMemo<ListEntry[]>(() => {
    if (!sections || sections.length === 0) {
      return rows.map((row, idx) => ({ kind: "row", row, idx }));
    }
    const out: ListEntry[] = [];
    let next = 0;
    for (const marker of sections) {
      // Défensif : un marqueur en retard ne doit pas avaler les lignes qui le
      // précèdent (elles sortiraient de la liste au lieu d'être rendues).
      for (; next < marker.index && next < rows.length; next++) {
        out.push({ kind: "row", row: rows[next]!, idx: next });
      }
      out.push({ kind: "header", marker });
    }
    for (; next < rows.length; next++) out.push({ kind: "row", row: rows[next]!, idx: next });
    return out;
  }, [rows, sections]);

  /** Index de ligne → index d'entrée (scroll-into-view du curseur clavier). */
  const entryIndexOfRow = useMemo(() => {
    const map = new Map<number, number>();
    entries.forEach((e, i) => {
      if (e.kind === "row") map.set(e.idx, i);
    });
    return map;
  }, [entries]);

  // ── Virtualisation ────────────────────────────────────────────────────────
  // Activée seulement au-delà du seuil ET quand la page nous a passé son
  // conteneur scrollable. Hauteurs dynamiques : `measureElement` remplace
  // l'estimation dès que la ligne est montée (densité, groupes multi-lignes).
  const virtualized = rows.length > VIRTUALIZE_THRESHOLD && Boolean(scrollElementRef?.current);
  const virtualizer = useVirtualizer({
    count: entries.length,
    getScrollElement: () => scrollElementRef?.current ?? null,
    estimateSize: (i) =>
      entries[i]?.kind === "header" ? HEADER_ESTIMATE : ROW_ESTIMATE[density],
    overscan: 8,
    getItemKey: (i) => entryKey(entries[i], i),
  });

  // Curseur clavier hors fenêtre rendue : on l'y ramène (sinon `j` semble ne
  // rien faire — la ligne existe mais n'est pas montée).
  useEffect(() => {
    if (!virtualized || selectedIndex == null || selectedIndex < 0) return;
    virtualizer.scrollToIndex(entryIndexOfRow.get(selectedIndex) ?? selectedIndex, {
      align: "auto",
    });
    // `virtualizer` est stable pour un même conteneur.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedIndex, virtualized]);

  const shared: SharedRowProps = {
    activeKey,
    onPick,
    onToggleStar,
    labelColors,
    selectedIndex,
    selectedThreadIds,
    onToggleRowSelection,
    selectable,
    anySelected,
    dndEnabled,
    onOpenContext: setCtx,
    density,
    onSwipeRow,
    onLongPressRow,
    summaries,
  };

  return (
    <>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        {virtualized ? (
          <div
            className="relative w-full"
            role="listbox"
            aria-label="Boîte mail"
            style={{ height: virtualizer.getTotalSize() }}
          >
            {virtualizer.getVirtualItems().map((v) => {
              const entry = entries[v.index]!;
              return (
                <div
                  key={entryKey(entry, v.index)}
                  ref={virtualizer.measureElement}
                  data-index={v.index}
                  className="absolute left-0 top-0 w-full pb-1"
                  style={{ transform: `translateY(${v.start}px)` }}
                >
                  {entry.kind === "header" ? (
                    <MailSectionHeader
                      marker={entry.marker}
                      first={v.index === 0}
                      onToggle={onToggleSection}
                      onMarkRead={onMarkSectionRead}
                    />
                  ) : (
                    <MailRow row={entry.row} idx={entry.idx} shared={shared} />
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="flex flex-col gap-1" role="listbox" aria-label="Boîte mail">
            {entries.map((entry, i) =>
              entry.kind === "header" ? (
                <MailSectionHeader
                  key={`h:${entry.marker.id}`}
                  marker={entry.marker}
                  first={i === 0}
                  onToggle={onToggleSection}
                  onMarkRead={onMarkSectionRead}
                />
              ) : (
                <MailRow
                  key={entry.row.kind === "single" ? `t:${entry.row.item.id}` : entry.row.key}
                  row={entry.row}
                  idx={entry.idx}
                  shared={shared}
                />
              ),
            )}
          </div>
        )}
      </DndContext>
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
          onApplyLabel={onApplyLabel}
          userLabels={userLabels}
        />
      )}
    </>
  );
}

/**
 * Pile d'avatars des expéditeurs d'un groupe (repère : les « bundles » de
 * Shortwave). Dit QUI est dans le paquet avant de l'ouvrir — un compteur seul
 * ne le dit pas. Décoratif : le texte de la ligne porte déjà l'information, d'où
 * `aria-hidden` (sinon le lecteur d'écran récite des initiales).
 */
function SenderStack({
  senders,
  size,
}: {
  senders: { name: string; email: string }[];
  size: number;
}) {
  return (
    <span className="flex shrink-0 items-center" aria-hidden>
      {senders.map((sender, i) => {
        const color = avatarColor(sender.email || sender.name);
        return (
          <span
            key={`${sender.email || sender.name}:${i}`}
            className={`flex items-center justify-center rounded-md font-semibold ${
              i > 0 ? "-ml-1.5" : ""
            }`}
            style={{
              width: size,
              height: size,
              fontSize: Math.round(size * 0.42),
              backgroundColor: color.bg,
              color: color.fg,
              // Liseré à la couleur du fond : sépare deux pastilles qui se
              // chevauchent, quel que soit le thème.
              boxShadow: "0 0 0 1.5px var(--surface-0)",
              zIndex: senders.length - i,
            }}
          >
            {initials(sender.name, sender.email)}
          </span>
        );
      })}
    </span>
  );
}

/**
 * Mini-en-tête de section : libellé, compteur (non lus / total), repli, et
 * « tout marquer lu » quand il reste des non-lus. Deux Boutons FRÈRES et non
 * imbriqués — une action dans un bouton ne serait atteignable ni au clavier ni
 * au lecteur d'écran.
 */
function MailSectionHeader({
  marker,
  first,
  onToggle,
  onMarkRead,
}: {
  marker: MailSectionMarker;
  /** Premier en-tête de la liste : pas de filet de séparation au-dessus. */
  first: boolean;
  onToggle?: (id: MailSectionId) => void;
  onMarkRead?: (threadIds: string[]) => void;
}) {
  return (
    <div
      role="presentation"
      className={`flex items-center gap-1 px-1 pb-0.5 ${first ? "pt-0.5" : "mt-1 pt-2"}`}
      style={first ? undefined : { borderTop: "1px solid var(--border-subtle)" }}
    >
      <Button
        variant="ghost"
        size="sm"
        className="h-8 min-w-0 flex-1 justify-start gap-1.5 px-1.5 md:h-6"
        aria-expanded={!marker.collapsed}
        aria-label={`${marker.title} — ${marker.count} fil(s)${
          marker.unread > 0 ? `, ${marker.unread} non lu(s)` : ""
        }`}
        onPress={() => onToggle?.(marker.id)}
      >
        <CaretDown
          size={11}
          weight="bold"
          aria-hidden
          className={`shrink-0 transition-transform ${marker.collapsed ? "-rotate-90" : ""}`}
          style={{ color: "var(--text-muted)" }}
        />
        <span
          className="truncate text-[11px] font-semibold uppercase tracking-wider"
          style={{ color: "var(--text-muted)" }}
        >
          {marker.title}
        </span>
        <span
          className={`shrink-0 text-[11px] ${marker.unread > 0 ? "font-bold" : ""}`}
          style={{ color: marker.unread > 0 ? "var(--accent)" : "var(--text-muted)" }}
        >
          {marker.unread > 0 ? `${marker.unread}/${marker.count}` : marker.count}
        </span>
      </Button>
      {marker.unread > 0 && onMarkRead && (
        <Button
          variant="ghost"
          size="sm"
          isIconOnly
          className="h-8 w-8 shrink-0 md:h-6 md:w-6"
          aria-label={`Marquer « ${marker.title} » comme lu`}
          onPress={() => onMarkRead(marker.unreadIds)}
        >
          <Checks size={13} aria-hidden style={{ color: "var(--text-muted)" }} />
        </Button>
      )}
    </div>
  );
}

/** Une ligne de la boîte : source draggable (single) ou cible droppable
 *  (groupe-tag). Les hooks DnD sont TOUJOURS appelés (règle des hooks) et
 *  neutralisés via `disabled` selon le type de ligne et `dndEnabled`. */
function MailRow({ row, idx, shared }: { row: OverlayRow; idx: number; shared: SharedRowProps }) {
  const {
    activeKey,
    onPick,
    onToggleStar,
    labelColors,
    selectedIndex,
    selectedThreadIds,
    onToggleRowSelection,
    selectable,
    anySelected,
    dndEnabled,
    onOpenContext,
    density,
    onSwipeRow,
    onLongPressRow,
    summaries,
  } = shared;

  const key = row.kind === "single" ? `t:${row.item.id}` : row.key;
  const isSingle = row.kind === "single";
  const isLabel = row.kind === "group" && row.groupType === "label";
  const labelId =
    row.kind === "group" && row.groupType === "label" && row.key.startsWith("label:")
      ? row.key.slice("label:".length)
      : null;

  // DnD : ligne single = source ; groupe-label = cible. Un thread déjà porteur
  // du tag ne le re-déclenche pas (vérifié au drop via les labelIds).
  const drag = useDraggable({
    id: `drag:${key}`,
    disabled: !dndEnabled || !isSingle,
    data: {
      type: "thread",
      threadId: row.kind === "single" ? row.item.id : "",
      labelIds: row.kind === "single" ? row.item.labelIds : [],
    },
  });
  const drop = useDroppable({
    id: `drop:${key}`,
    disabled: !dndEnabled || !isLabel,
    data: { type: "labelGroup", labelId },
  });

  const title = row.kind === "single" ? row.item.from.name || row.item.from.email : row.title;
  const subject = row.kind === "single" ? row.item.subject : row.items[0]?.subject ?? "";
  const date = row.kind === "single" ? row.item.date : row.date;
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
  // Aperçu sous l'objet : le mini-résumé de l'IA locale quand il existe, sinon
  // le snippet Gmail (début brut du corps). On distingue visuellement les deux :
  // un résumé est une INTERPRÉTATION du message, pas une citation.
  const previewItem = row.kind === "single" ? row.item : row.items[0];
  const aiSummary = previewItem ? summaries?.get(previewItem.id) : undefined;
  const preview = aiSummary ?? previewItem?.snippet ?? "";
  const aiPreview = Boolean(aiSummary);
  const avatar = avatarColor(fromAddr?.email || fromAddr?.name || title);
  const mono = initials(fromAddr?.name ?? "", fromAddr?.email ?? title);
  // Groupe à plusieurs expéditeurs → pile d'avatars plutôt qu'un monogramme
  // unique, qui ne représenterait que le premier du paquet.
  const stack = row.kind === "group" ? distinctSenders(row, SENDER_STACK_MAX) : [];
  const showStack = stack.length > 1;

  const rowButton = (
    <Button
      data-mail-row-index={idx}
      variant="ghost"
      onPress={() => onPick(row)}
      className={`h-auto w-full min-w-0 flex-1 justify-start whitespace-normal rounded-lg px-2.5 text-left ${
        isLabel ? "py-1.5" : density === "compact" ? "py-1" : "py-2.5"
      }${
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
      {isLabel ? (
        /* Groupe-label COMPACT : une seule ligne = le badge/tag coloré (nom
           + couleur Gmail, comme dans le fil) + compteur + date. Pas d'avatar
           icône (sans information), ni objet/aperçu du 1ᵉʳ mail (on ouvre le
           groupe pour les voir). */
        <span className="flex w-full min-w-0 items-center gap-2">
          <span
            className="inline-flex min-w-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium"
            style={
              labelColor
                ? { backgroundColor: labelColor.backgroundColor, color: labelColor.textColor }
                : { backgroundColor: "var(--accent-subtle)", color: "var(--accent)" }
            }
          >
            <Tag size={11} className="shrink-0" aria-hidden />
            <span className="truncate">{title}</span>
          </span>
          {row.kind === "group" && row.count > 1 && (
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
          {showStack && <SenderStack senders={stack} size={16} />}
          {/* Objets du paquet : un groupe-tag qui n'affiche que son nom et un
              compteur oblige à l'ouvrir pour savoir ce qu'il contient. Les
              premiers objets suffisent à décider (repère : Shortwave). */}
          {row.kind === "group" && (
            <span
              className="min-w-0 flex-1 truncate text-[13px]"
              style={{ color: "var(--text-secondary)" }}
            >
              {row.items.slice(0, GROUP_SUBJECT_MAX).map((it, i) => (
                <span key={it.id}>
                  {i > 0 && <span style={{ color: "var(--border)" }}>{"  |  "}</span>}
                  <span
                    style={
                      it.labelIds.includes("UNREAD")
                        ? { fontWeight: 600, color: "var(--text-primary)" }
                        : undefined
                    }
                  >
                    {it.subject || "(sans objet)"}
                  </span>
                </span>
              ))}
            </span>
          )}
          {starred && (
            <Star
              size={13}
              weight="fill"
              aria-label="Contient un message étoilé"
              className="shrink-0"
              style={{ color: "#f5b300" }}
            />
          )}
          <span className="ml-auto shrink-0 text-xs" style={{ color: "var(--text-muted)" }}>
            {formatMailDate(date)}
          </span>
        </span>
      ) : density === "compact" ? (
        /* Densité COMPACTE : une seule ligne — pastille non-lu, expéditeur,
           objet, aperçu grisé, date, étoile. Objectif : voir 3× plus de fils à
           l'écran (repère : Superhuman). Aucune information n'est perdue,
           seulement resserrée ; le survol ne tronque pas davantage. */
        <span className="flex w-full min-w-0 items-center gap-2">
          <span
            aria-label={unread ? "Non lu" : undefined}
            className="h-1.5 w-1.5 shrink-0 rounded-full"
            style={{ backgroundColor: unread ? "var(--accent)" : "transparent" }}
          />
          <span
            className={`w-40 shrink-0 truncate text-[13px] ${unread ? "font-semibold" : "font-medium"}`}
            style={{ color: "var(--text-primary)" }}
          >
            {title}
          </span>
          {row.kind === "group" && row.count > 1 && (
            <span
              className={`shrink-0 rounded-full px-1.5 text-[11px] ${groupUnread > 0 ? "font-bold" : ""}`}
              style={{ background: "var(--accent-subtle)", color: "var(--accent)" }}
              title={`${row.count} fils`}
            >
              {groupUnread > 0 ? `${groupUnread}/${row.count}` : row.count}
            </span>
          )}
          <span className="min-w-0 flex-1 truncate text-[13px]" style={{ color: "var(--text-secondary)" }}>
            {subject}
            {preview && (
              <span
                style={{ color: "var(--text-muted)" }}
                title={aiPreview ? "Résumé par l'IA locale" : undefined}
              >
                {" — "}
                {aiPreview && (
                  <Sparkle
                    size={10}
                    weight="fill"
                    aria-hidden
                    className="inline align-[-1px]"
                    style={{ color: "var(--accent)" }}
                  />
                )}{" "}
                {preview}
              </span>
            )}
          </span>
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
                size={13}
                weight={starred ? "fill" : "regular"}
                style={{ color: starred ? "#f5b300" : "var(--text-muted)" }}
              />
            </span>
          ) : (
            starred && (
              <Star size={13} weight="fill" aria-hidden className="shrink-0" style={{ color: "#f5b300" }} />
            )
          )}
          <span className="w-14 shrink-0 text-right text-[11px]" style={{ color: "var(--text-muted)" }}>
            {formatMailDate(date)}
          </span>
        </span>
      ) : (
      <span className="flex w-full min-w-0 items-start gap-2.5">
        {/* Monogramme expéditeur (signature visuelle) : initiales sur fond
            déterministe sobre. Pastille non-lu en surimpression coin
            haut-gauche. */}
        <span className="relative shrink-0">
          {showStack ? (
            <SenderStack senders={stack} size={28} />
          ) : (
            <span
              aria-hidden
              className="flex h-8 w-8 items-center justify-center rounded-lg text-xs font-semibold"
              style={{ backgroundColor: avatar.bg, color: avatar.fg }}
            >
              {mono}
            </span>
          )}
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
            {row.kind === "group" && row.count > 1 && (
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
            /* Résumé IA : deux lignes (une trentaine de mots ne tient pas sur
               une ligne tronquée). Snippet Gmail : une ligne, comme avant. */
            <span
              className={`flex min-w-0 items-start gap-1 text-xs ${
                aiPreview ? "" : "truncate"
              }`}
              style={{ color: "var(--text-muted)" }}
              title={aiPreview ? "Résumé par l'IA locale" : undefined}
            >
              {aiPreview && (
                <Sparkle
                  size={11}
                  weight="fill"
                  aria-hidden
                  className="mt-0.5 shrink-0"
                  style={{ color: "var(--accent)" }}
                />
              )}
              <span className={aiPreview ? "line-clamp-2 min-w-0" : "min-w-0 truncate"}>
                {preview}
              </span>
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
      )}
    </Button>
  );

  // Toute ligne est enveloppée pour porter le clic droit (menu contextuel)
  // et, en mode sélection, la Checkbox à côté du Button (jamais imbriquée —
  // un control interactif dans un Button serait invalide). La case n'apparaît
  // qu'au survol tant qu'aucune sélection n'est active ; visible dès qu'une
  // case (ou la ligne) est cochée. Hit-target tactile ≥32px.
  const showBox = selectable && (anySelected || checkState !== "unchecked");

  // Style DnD : la ligne draggée suit le pointeur (translate) et s'estompe ;
  // un groupe-tag survolé par un drop se met en surbrillance pointillée. Les
  // listeners de drag vivent sur une POIGNÉE dédiée (pas sur la ligne) : la
  // surface de la ligne est un <Button> HeroUI dont react-aria capte le
  // pointerdown (stopPropagation) — un wrapper draggable ne recevrait jamais
  // l'évènement. La poignée, hors du Button, contourne ça.
  const draggableActive = dndEnabled && isSingle;
  const dragMove: CSSProperties = draggableActive
    ? {
        transform: CSS.Translate.toString(drag.transform),
        opacity: drag.isDragging ? 0.4 : 1,
        zIndex: drag.isDragging ? 30 : undefined,
        position: drag.isDragging ? "relative" : undefined,
        transition: drag.isDragging
          ? "var(--sn-transition-opacity)"
          : "transform var(--sn-dur-2) var(--sn-ease-glide), var(--sn-transition-opacity)",
      }
    : {};
  const dropStyle: CSSProperties =
    dndEnabled && isLabel && drop.isOver
      ? {
          outline: "2px dashed var(--accent)",
          outlineOffset: "2px",
          borderRadius: "0.5rem",
          backgroundColor: "var(--accent-subtle)",
        }
      : {};

  // Gestes tactiles : uniquement sur une ligne `single` (une action de triage
  // sur un groupe entier serait ambiguë).
  const swipeEnabled = Boolean(onSwipeRow) && isSingle;

  const body = (
    <div
      ref={drop.setNodeRef}
      className={`flex items-center gap-1${selectable ? " group" : ""}`}
      style={{ ...dragMove, ...dropStyle }}
      onContextMenu={(e) => {
        e.preventDefault();
        onOpenContext({ x: e.clientX, y: e.clientY, row });
      }}
    >
      {draggableActive && (
        <span
          ref={drag.setNodeRef}
          {...drag.listeners}
          {...drag.attributes}
          aria-label="Glisser cet email vers un tag"
          title="Glisser vers un tag"
          className="flex h-8 w-4 shrink-0 cursor-grab items-center justify-center rounded text-[var(--text-muted)] transition-colors hover:text-[var(--accent)]"
          style={{ touchAction: "none" }}
        >
          <DotsSixVertical size={15} weight="bold" aria-hidden />
        </span>
      )}
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

  if (!swipeEnabled) return body;
  return (
    <SwipeableRow
      onSwipe={(action) => onSwipeRow?.(row, action)}
      {...(onLongPressRow ? { onLongPress: () => onLongPressRow(row) } : {})}
    >
      {body}
    </SwipeableRow>
  );
}

/**
 * Menu contextuel (clic droit) d'une ligne de la boîte mail. Positionné en fixe
 * au curseur, fermé au clic-extérieur / Échap. Actions selon `row.kind` : une
 * ligne `single` propose ouvrir / étoile / lu-non lu / ajouter un tag / → Todo
 * (4 quadrants) / triage (Fait/Archiver/Reporter/Supprimer) ; un groupe → « Ouvrir ».
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
  onApplyLabel,
  userLabels,
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
  onApplyLabel?: (threadId: string, labelId: string) => void;
  userLabels?: Map<string, string>;
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

  // Tags applicables : labels user que ce thread ne porte pas encore.
  const addableLabels =
    single && onApplyLabel && userLabels
      ? [...userLabels.entries()].filter(([id]) => !single.labelIds.includes(id))
      : [];

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
      {single && onApplyLabel && addableLabels.length > 0 && (
        <>
          <CtxSep />
          <CtxLabel text="Ajouter un tag" />
          {addableLabels.map(([id, name]) => (
            <CtxItem
              key={id}
              label={name}
              indent
              onClick={() => run(() => onApplyLabel(single.id, id))}
            />
          ))}
        </>
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
      className="sn-eyebrow sn-eyebrow--compact px-2 pt-1"
    >
      {text}
    </div>
  );
}
