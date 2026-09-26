"use client";

import { ArrowBendUpLeft, CheckSquare, Clock, Database, ListChecks, type Icon } from "@phosphor-icons/react";
import { formatTime } from "@/lib/agenda/dates";
import type { AgendaOverlay } from "./useAgendaData";

const ICONS: Record<AgendaOverlay["kind"], Icon> = {
  todo: CheckSquare,
  checklist: ListChecks,
  snooze: Clock,
  followup: ArrowBendUpLeft,
  base: Database,
};

const KIND_LABEL: Record<AgendaOverlay["kind"], string> = {
  todo: "Todo",
  checklist: "Tâche de note",
  snooze: "Report mail",
  followup: "Relance mail",
  base: "Base",
};

/** Élément que Supernote connaît déjà (todo, report, date de base) : on l'ouvre à sa place. */
export function OverlayChip({ overlay, showTime = false, roomy = false }: { overlay: AgendaOverlay; showTime?: boolean; roomy?: boolean }) {
  const IconCmp = ICONS[overlay.kind];
  return (
    <button
      type="button"
      onClick={overlay.onOpen}
      aria-label={`${KIND_LABEL[overlay.kind]} : ${overlay.title}`}
      className={`flex w-full min-w-0 items-center text-left outline-none ${roomy ? "min-h-10 gap-2 rounded-lg px-3 text-sm" : "gap-1 rounded px-1.5 py-0.5 text-xs"} transition-colors hover:bg-[var(--nav-hover-bg)] focus-visible:ring-2 focus-visible:ring-[var(--border-focus)]`}
      style={{ color: "var(--text-secondary)", border: "1px dashed var(--border)" }}
    >
      <IconCmp size={roomy ? 16 : 12} aria-hidden className="shrink-0" />
      {showTime && overlay.atMs !== null && <span className="shrink-0 tabular-nums">{formatTime(overlay.atMs)}</span>}
      <span className="truncate">{overlay.title}</span>
    </button>
  );
}
