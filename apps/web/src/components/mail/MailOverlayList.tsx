"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Button, Tooltip } from "@supernote/ui";
import { Checkbox } from "@supernote/ui";
import { Star, DotsSixVertical, Sparkle, CaretDown, Checks, Clock, Trash } from "@phosphor-icons/react";
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
import { formatMailDate } from "@/lib/mail-date";
import { PUBLIC_DOMAINS, awaitsMyReply, isSelfAddress } from "@/lib/mail-awaiting";
import { ContactAvatar } from "@/components/contacts/ContactAvatar";
import { SwipeableRow, type SwipeAction } from "./SwipeableRow";
import { LabelMarker, RowLabelChips, labelChipSoftStyle } from "./LabelMarker";

/** Données partagées par toutes les lignes — évite de threader une douzaine de
 *  props à travers `MailRow`. */
interface SharedRowProps {
  activeKey?: string;
  onPick: (row: OverlayRow) => void;
  onToggleStar?: (threadId: string, labelIds: string[]) => void;
  labelColors?: Map<string, GmailLabelColor>;
  /** Labels utilisateur (id → nom), affichés en pastilles sur les lignes. */
  labelNames?: Map<string, string>;
  selectedIndex?: number;
  selectedThreadIds?: ReadonlySet<string>;
  onToggleRowSelection?: (row: OverlayRow) => void;
  selectable: boolean;
  anySelected: boolean;
  /** Drag-vers-groupe actif (desktop). Quand faux, les lignes ne sont ni
   *  draggables ni droppables (et la liste défile normalement sur tactile). */
  dndEnabled: boolean;
  onOpenContext: (c: { x: number; y: number; row: OverlayRow }) => void;
  /** Gestes tactiles (mobile) : glisser pour archiver / reporter. */
  onSwipeRow?: (row: OverlayRow, action: SwipeAction) => void;
  /** Appui long (mobile) : feuille d'actions de la ligne. */
  onLongPressRow?: (row: OverlayRow) => void;
  onSnoozeRow?: (row: OverlayRow) => void;
  onTriageRow?: (row: OverlayRow, action: TriageAction, until?: number) => void;
  indexAttr: RowIndexAttr;
  hideLabelId?: string;
  /** threadId → mini-résumé IA. Remplace le snippet Gmail quand il existe. */
  summaries?: ReadonlyMap<string, string>;
  selfEmails: readonly string[];
}

/**
 * Au-delà de ce nombre de lignes, la liste est VIRTUALISÉE (seules les lignes
 * visibles sont montées). En dessous, rendu direct : le drag-vers-tag reste
 * pleinement fonctionnel (une cible de drop hors fenêtre ne serait pas montée),
 * et une boîte « inbox zero » tient largement sous ce seuil.
 */
const VIRTUALIZE_THRESHOLD = 60;

/** Hauteur estimée d'une ligne (avant mesure réelle). */
const ROW_ESTIMATE = 36;

const EMBER = "oklch(0.72 0.17 50)";
const DAY_MS = 86_400_000;

function waitAge(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / DAY_MS);
  return Number.isNaN(days) || days < 1 ? "" : `${days} j`;
}
const NO_SELF: readonly string[] = [];
// Label nommé d'après une boîte (alias de réception) : pas un tag, il ne s'affiche pas en chip.
const EMAIL_LIKE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Hauteur estimée d'un en-tête de section (avant mesure réelle). */
const HEADER_ESTIMATE = 34;

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

// Logo du domaine expéditeur (cache navigateur 7 j) ; domaine inconnu = globe 16 px de Google → initiales.
// shortcut: garde les 2 derniers labels, rate les suffixes type co.uk ; passer à une liste PSL si ça gêne.
function senderLogoUrl(email: string): string | undefined {
  const domain = email.slice(email.lastIndexOf("@") + 1).toLowerCase().split(".").slice(-2).join(".");
  if (!domain.includes(".") || PUBLIC_DOMAINS.has(domain)) return undefined;
  return `https://t1.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=https://${domain}&size=64`;
}

type RowIndexAttr = "data-mail-row-index" | "data-mail-group-index";

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
  onSnoozeRow,
  onMarkRowRead,
  onApplyLabel,
  userLabels,
  scrollElementRef,
  onSwipeRow,
  onLongPressRow,
  summaries,
  selfEmails = NO_SELF,
  sections,
  onToggleSection,
  onMarkSectionRead,
  menuRequest = 0,
  indexAttr = "data-mail-row-index",
  hideLabelId,
}: {
  /** Marqueur DOM d'index de ligne, suivi par le curseur clavier de la page (liste principale ou volet de groupe). */
  indexAttr?: RowIndexAttr;
  /** Label commun à toutes les lignes (volet d'un groupe-tag) : pas répété en pastille. */
  hideLabelId?: string;
  /** Incrémenté par la page (touche « . ») : ouvre le menu de la ligne `selectedIndex`. */
  menuRequest?: number;
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
  /** Clic droit : ranger une ligne single dans un quadrant (label Gmail). */
  onConvertRowToTodo?: (row: OverlayRow, quadrant: EisenhowerQuadrant) => void;
  /** Clic droit : triage rapide d'une ligne single (`until` = échéance snooze). */
  onTriageRow?: (row: OverlayRow, action: TriageAction, until?: number) => void;
  /** Bouton « Reporter » au survol : ouvre le SnoozeMenu de la page sur cette ligne. */
  onSnoozeRow?: (row: OverlayRow) => void;
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
  /** Adresses « à moi » : un fil dont le dernier message n'en vient pas attend ta réponse. */
  selfEmails?: readonly string[];
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
  // l'estimation dès que la ligne est montée (groupes multi-lignes).
  const virtualized = rows.length > VIRTUALIZE_THRESHOLD && Boolean(scrollElementRef?.current);
  const virtualizer = useVirtualizer({
    count: entries.length,
    getScrollElement: () => scrollElementRef?.current ?? null,
    estimateSize: (i) =>
      entries[i]?.kind === "header" ? HEADER_ESTIMATE : ROW_ESTIMATE,
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

  useEffect(() => {
    if (!menuRequest || selectedIndex == null || selectedIndex < 0) return;
    const row = rows[selectedIndex];
    const el = document.querySelector(`[${indexAttr}="${selectedIndex}"]`);
    if (!row || !el) return;
    const r = el.getBoundingClientRect();
    setCtx({ x: r.left + 24, y: r.bottom, row });
    // Seul un nouvel appui compte, pas un déplacement du curseur.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menuRequest]);

  const shared: SharedRowProps = {
    activeKey,
    onPick,
    onToggleStar,
    labelColors,
    labelNames: userLabels,
    selectedIndex,
    selectedThreadIds,
    onToggleRowSelection,
    selectable,
    anySelected,
    dndEnabled,
    onOpenContext: setCtx,
    onSwipeRow,
    onLongPressRow,
    onSnoozeRow,
    onTriageRow,
    indexAttr,
    hideLabelId,
    summaries,
    selfEmails,
  };

  return (
    <>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        {virtualized ? (
          <div
            className="@container relative w-full"
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
                  className="absolute left-0 top-0 w-full"
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
          <div className="@container flex flex-col" role="listbox" aria-label="Boîte mail">
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
      className={`flex items-center gap-1 border-b px-1 pb-0.5 ${first ? "pt-0.5" : "pt-3"}`}
      style={{ borderColor: "var(--border)" }}
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
          className="truncate font-mono text-[10.5px] uppercase tracking-[0.08em]"
          style={{ color: marker.id === "awaiting" ? EMBER : "var(--text-muted)" }}
        >
          {marker.title}
        </span>
        <span
          className="shrink-0 font-mono text-[10.5px] tabular-nums"
          style={{ color: marker.unread > 0 ? "var(--text-primary)" : "var(--text-muted)" }}
        >
          {marker.unread > 0 ? `${marker.unread}/${marker.count}` : marker.count}
        </span>
      </Button>
      {marker.unread > 0 && onMarkRead && (
        <Button
          variant="ghost"
          size="icon"
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
    labelNames,
    selectedIndex,
    selectedThreadIds,
    onToggleRowSelection,
    selectable,
    anySelected,
    dndEnabled,
    onOpenContext,
    onSwipeRow,
    onLongPressRow,
    onSnoozeRow,
    onTriageRow,
    indexAttr,
    hideLabelId,
    summaries,
    selfEmails,
  } = shared;

  const key = row.kind === "single" ? `t:${row.item.id}` : row.key;
  const isSingle = row.kind === "single";
  const isLabel = row.kind === "group" && row.groupType === "label";
  const labelId =
    row.kind === "group" && row.groupType === "label" && row.key.startsWith("label:")
      ? row.key.slice("label:".length).replace(/#star$/, "")
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

  // Console : une ligne = statut · qui · quoi · quand, colonnes fixes pour lire 300 mails/jour en diagonale.
  const who =
    row.kind === "group" && row.groupType === "label" ? (
      <span
        className="inline-flex min-w-0 items-center gap-1 rounded-[4px] px-1.5 text-[12px] font-medium leading-5"
        style={labelChipSoftStyle(labelColor)}
        title={title}
      >
        <span className="truncate">{title.replace(/^Supernote\//, "")}</span>
      </span>
    ) : row.kind === "single" && isSelfAddress(row.item.from.email, selfEmails) ? (
      // Dernier message de moi : la balle est chez eux.
      <span className="truncate" style={{ color: "var(--text-muted)" }} title="Dernier message envoyé par moi : la balle est chez eux">
        Moi <span className="font-mono text-[11px]">↗</span>
      </span>
    ) : (
      <span className="truncate">{title}</span>
    );
  const senders = row.kind === "group" ? distinctSenders(row, 6).map((f) => f.name || f.email).join(", ") : "";
  // Braise : le dernier message vient d'une personne, la balle est dans ton camp.
  const awaitingCount = (row.kind === "single" ? [row.item] : row.items).filter((it) =>
    awaitsMyReply(it, selfEmails),
  ).length;
  const awaiting = awaitingCount > 0;
  const focused = activeKey === key || cursored;
  const rowBg: CSSProperties | undefined =
    activeKey === key
      ? { backgroundColor: "var(--accent-subtle)", boxShadow: "inset 2px 0 0 0 var(--accent)" }
      : cursored
        ? { backgroundColor: "var(--surface-2, var(--accent-subtle))", boxShadow: "inset 2px 0 0 0 var(--text-muted)" }
        : awaiting
          ? { boxShadow: `inset 2px 0 0 0 ${EMBER}` }
          : undefined;
  const chips = singleItem ? (
    <RowLabelChips
      labelIds={singleItem.labelIds.filter((id) => id !== hideLabelId && !EMAIL_LIKE.test(labelNames?.get(id) ?? ""))}
      names={labelNames}
      colors={labelColors}
    />
  ) : null;

  const rowButton = (
    <Button
      {...{ [indexAttr]: idx }}
      variant="ghost"
      onPress={() => onPick(row)}
      className="h-auto min-h-0 w-full min-w-0 flex-1 justify-start whitespace-normal rounded-none px-2.5 py-1.5 text-left @xl:py-[7px]"
      aria-selected={focused}
    >
      <span className="grid w-full min-w-0 grid-cols-[10px_minmax(0,1fr)_auto] items-center gap-x-2.5 gap-y-0.5 @xl:grid-cols-[10px_144px_minmax(0,1fr)_auto] @xl:gap-x-3">
        <span className="col-start-1 row-start-1 flex items-center justify-center" aria-hidden>
          {awaiting ? (
            <span className="sn-ember" />
          ) : unread ? (
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: "var(--accent)" }} />
          ) : null}
        </span>
        {(unread || awaiting) && (
          <span className="sr-only">
            {[unread && "Non lu", awaiting && "À toi de répondre"].filter(Boolean).join(", ")}
          </span>
        )}

        <span
          title={senders || fromAddr?.email || undefined}
          className={`col-start-2 row-start-1 flex min-w-0 items-center gap-1.5 text-[13px] ${unread ? "font-semibold" : "font-medium"}`}
          style={{ color: unread || awaiting ? "var(--text-primary)" : "var(--text-secondary)" }}
        >
          {who}
          {row.kind === "group" && row.count > 1 && (
            <span
              className="shrink-0 font-mono text-[10.5px] tabular-nums"
              title={groupUnread > 0 ? `${groupUnread} non lu${groupUnread > 1 ? "s" : ""} sur ${row.count}` : `${row.count} fils`}
              style={{ color: groupUnread > 0 ? "var(--text-primary)" : "var(--text-muted)" }}
            >
              {groupUnread > 0 ? `${groupUnread}/${row.count}` : `×${row.count}`}
            </span>
          )}
        </span>

        <span className="col-start-2 col-end-4 row-start-2 flex min-w-0 items-center gap-1.5 text-[13px] @xl:col-start-3 @xl:col-end-4 @xl:row-start-1">
          {row.kind === "group" ? (
            <span className="min-w-0 flex-1 truncate" style={{ color: "var(--text-secondary)" }}>
              {row.items.slice(0, GROUP_SUBJECT_MAX).map((it, i) => (
                <span key={it.id}>
                  {i > 0 && <span style={{ color: "var(--text-muted)" }}>{" · "}</span>}
                  <span
                    style={it.labelIds.includes("UNREAD") ? { fontWeight: 600, color: "var(--text-primary)" } : undefined}
                  >
                    {it.subject || "(sans objet)"}
                  </span>
                </span>
              ))}
            </span>
          ) : (
            <>
              <span
                className={`min-w-0 truncate ${unread ? "font-semibold" : ""}`}
                style={{ color: unread || awaiting ? "var(--text-primary)" : "var(--text-secondary)" }}
              >
                {subject || "(sans objet)"}
              </span>
              {chips}
              {preview && !focused && (
                <span
                  className="hidden min-w-[35%] flex-1 items-center gap-1 @xl:flex"
                  style={{ color: "var(--text-muted)" }}
                  title={aiPreview ? `Résumé par l'IA locale : ${preview}` : preview}
                >
                  <span aria-hidden>—</span>
                  <span className="min-w-0 truncate">{preview}</span>
                </span>
              )}
            </>
          )}
        </span>

        {/* Desktop : ligne compacte, résumé déplié sur la ligne active (pas dans le rail, le fil l'affiche) ; mobile : toujours. */}
        {preview && row.kind === "single" && (
          <span
            className={`col-start-2 col-end-4 row-start-3 hidden min-w-0 items-start gap-1.5 text-[12px] leading-snug max-md:flex @xl:col-start-3 @xl:col-end-5 @xl:row-start-2${focused ? " @xl:flex" : ""}`}
            style={{ color: aiPreview ? "var(--text-secondary)" : "var(--text-muted)" }}
            title={aiPreview ? `Résumé par l'IA locale : ${preview}` : preview}
          >
            {aiPreview && (
              <Sparkle size={10} weight="fill" aria-hidden className="mt-[3px] shrink-0" style={{ color: "var(--text-muted)" }} />
            )}
            <span className="line-clamp-2 min-w-0">{preview}</span>
          </span>
        )}

        <span className="col-start-3 row-start-1 flex shrink-0 items-center gap-1.5 @xl:col-start-4">
          {starred && <Star size={13} weight="fill" aria-label="Étoilé" style={{ color: "var(--text-primary)" }} />}
          <span
            className="min-w-[3.25rem] text-right font-mono text-[11px] tabular-nums"
            style={{ color: awaiting ? EMBER : unread ? "var(--text-primary)" : "var(--text-muted)" }}
            title={formatMailDate(date)}
          >
            {/* En attente de moi : l'âge compte plus que la date. */}
            {((awaiting || (singleItem && isSelfAddress(singleItem.from.email, selfEmails))) && waitAge(date)) ||
              formatMailDate(date)}
          </span>
        </span>
      </span>
    </Button>
  );

  // L'avatar et sa case vivent hors du Button (un contrôle dans un Button serait invalide).
  const showBox = selectable && (anySelected || checkState !== "unchecked");

  // Style DnD : la ligne draggée suit le pointeur (translate) et s'estompe ;
  // un groupe-tag survolé par un drop se met en surbrillance pointillée. Les
  // listeners de drag vivent sur une POIGNÉE dédiée (pas sur la ligne) : la
  // surface de la ligne est un <Button variant="primary"> HeroUI dont react-aria capte le
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
      className="group group/row relative flex items-start border-b"
      style={{ borderColor: "var(--border-subtle)", ...rowBg, ...dragMove, ...dropStyle }}
      onContextMenu={(e) => {
        e.preventDefault();
        onOpenContext({ x: e.clientX, y: e.clientY, row });
      }}
    >
      {/* Poignée en surimpression dans la marge gauche : visible au survol, sans réserver de colonne. */}
      {draggableActive && (
        <span
          ref={drag.setNodeRef}
          {...drag.listeners}
          {...drag.attributes}
          aria-label="Glisser cet email vers un tag"
          title="Glisser vers un tag"
          className="absolute inset-y-0 left-0 z-[1] flex w-2.5 cursor-grab items-center justify-center text-[var(--text-muted)] opacity-0 transition-[opacity,color] hover:text-[var(--accent)] focus-visible:opacity-100 group-hover/row:opacity-100 max-md:hidden"
          style={{ touchAction: "none" }}
        >
          <DotsSixVertical size={12} weight="bold" aria-hidden />
        </span>
      )}
      {/* Avatar ; la case à cocher prend sa place au survol de l'avatar ou dès qu'une sélection existe. */}
      <span className="group/av relative ml-2.5 mt-[7px] flex h-[18px] w-[18px] shrink-0 items-center justify-center @xl:mt-2">
        {/* Groupe-tag : le marqueur du tag tient la place de l'avatar, la pastille ne garde que le nom. */}
        {!fromAddr && isLabel && (
          <span
            className={`flex transition-opacity ${selectable ? "group-hover/av:opacity-0 group-focus-within/av:opacity-0" : ""} ${showBox ? "opacity-0" : ""}`}
            style={{ color: labelChipSoftStyle(labelColor).color }}
          >
            <LabelMarker color={labelColor} size={14} />
          </span>
        )}
        {fromAddr && (
          <span
            className={`flex transition-opacity ${selectable ? "group-hover/av:opacity-0 group-focus-within/av:opacity-0" : ""} ${showBox ? "opacity-0" : ""}`}
          >
            <ContactAvatar
              name={fromAddr.name || fromAddr.email}
              photoUrl={senderLogoUrl(fromAddr.email)}
              size={18}
              minImageSize={32}
              className="shrink-0 bg-[var(--surface-2)]"
            />
          </span>
        )}
        {selectable && (
          <Checkbox
            isSelected={checkState === "checked"}
            isIndeterminate={checkState === "indeterminate"}
            onChange={() => onToggleRowSelection!(row)}
            className={`absolute inset-0 flex items-center justify-center transition-opacity group-hover/av:opacity-100 focus-within:opacity-100 ${
              showBox ? "opacity-100" : "opacity-0"
            }`}
            aria-label={
              checkState === "checked" ? "Désélectionner cette ligne" : "Sélectionner cette ligne"
            }
          />
        )}
      </span>
      {rowButton}
      {singleItem && (onToggleStar || onSnoozeRow || onTriageRow) && (
        // Hors du Button de ligne (pas de bouton dans un bouton) ; survol souris seulement, le tactile a le glissement et l'appui long.
        <div
          className="pointer-events-none absolute right-2 top-1 z-[1] flex items-center gap-0.5 rounded-md border p-0.5 opacity-0 group-focus-within/row:pointer-events-auto group-focus-within/row:opacity-100 group-hover/row:pointer-events-auto group-hover/row:opacity-100 max-md:hidden"
          style={{
            background: "var(--surface-1)",
            borderColor: "var(--border-subtle)",
            boxShadow: "0 1px 2px 0 rgb(0 0 0 / 0.05)",
            transition: "var(--sn-transition-opacity)",
          }}
        >
          {onToggleStar && (
            <RowAction
              label={starred ? "Retirer l'étoile" : "Mettre une étoile"}
              onPress={() => onToggleStar(singleItem.id, singleItem.labelIds)}
            >
              <Star size={14} weight={starred ? "fill" : "regular"} />
            </RowAction>
          )}
          {onSnoozeRow && (
            <RowAction label="Reporter" onPress={() => onSnoozeRow(row)}>
              <Clock size={14} />
            </RowAction>
          )}
          {onTriageRow && (
            <RowAction label="Supprimer" onPress={() => onTriageRow(row, "delete")}>
              <Trash size={14} />
            </RowAction>
          )}
        </div>
      )}
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

function RowAction({ label, onPress, children }: { label: string; onPress: () => void; children: ReactNode }) {
  return (
    <Tooltip content={label}>
      <Button
        variant="ghost"
        size="icon"
        aria-label={label}
        className="h-7 min-h-7 w-7 min-w-7"
        style={{ color: "var(--text-secondary)" }}
        onPress={onPress}
      >
        {children}
      </Button>
    </Tooltip>
  );
}

/**
 * Menu contextuel (clic droit) d'une ligne de la boîte mail. Positionné en fixe
 * au curseur, fermé au clic-extérieur / Échap. Actions selon `row.kind` : une
 * ligne `single` propose ouvrir / étoile / lu-non lu / ajouter un tag / → Todo
 * (4 quadrants) / triage (Fait/Reporter/Supprimer) ; un groupe → « Ouvrir ».
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
  // Le parent passe une flèche neuve à chaque rendu : l'effet ne doit pas se rejouer (il refocaliserait).
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    const onClose = () => onCloseRef.current();
    // Menu natif (ancré au pointeur, cf. exceptions HeroUI) : focus et flèches à la main.
    const returnTo = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const items = () => [...(ref.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    items()[0]?.focus();
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      // Menu ouvert = raccourcis de la page suspendus (Entrée ouvrirait aussi le fil).
      e.stopPropagation();
      const list = items();
      const at = list.indexOf(document.activeElement as HTMLElement);
      const move = (i: number) => {
        e.preventDefault();
        list[(i + list.length) % list.length]?.focus();
      };
      if (e.key === "ArrowDown") move(at + 1);
      else if (e.key === "ArrowUp") move(at < 0 ? -1 : at - 1);
      else if (e.key === "Home") move(0);
      else if (e.key === "End") move(-1);
      else if (e.key === "Escape" || e.key === "Tab") {
        e.preventDefault();
        onClose();
      }
    };
    const id = window.setTimeout(() => document.addEventListener("mousedown", onDown), 0);
    document.addEventListener("keydown", onKey, true);
    return () => {
      window.clearTimeout(id);
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey, true);
      returnTo?.focus({ preventScroll: true });
    };
  }, []);

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
  // Hauteur connue seulement une fois rendu (tags, quadrants, reports) : on recale avant peinture.
  const [top, setTop] = useState(y);
  useLayoutEffect(() => {
    const h = ref.current?.offsetHeight ?? 0;
    setTop(Math.max(8, Math.min(y, window.innerHeight - h - 8)));
  }, [y]);

  return (
    <div
      ref={ref}
      role="menu"
      aria-label="Actions de l'email"
      className="fixed z-50 flex max-h-[80vh] w-[230px] flex-col gap-0.5 overflow-y-auto rounded-lg p-1 shadow-xl"
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
          <CtxItem label="Fait" onClick={() => run(() => onTriage(row, "archive"))} />
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
      className={`w-full rounded-md px-2 py-1.5 text-left text-sm outline-none transition-colors hover:bg-[var(--surface-2)] focus-visible:bg-[var(--surface-2)] ${indent ? "pl-4" : ""}`}
      style={{ color: danger ? "var(--danger)" : "var(--text-primary)" }}
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
