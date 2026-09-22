"use client";

import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import type { CalCalendarRow, CalEventRow } from "@supernote/ipc";
import { CheckSquare, CloudArrowUp } from "@phosphor-icons/react";
import { formatSpan } from "@/lib/agenda/dates";

export function calendarColor(calendars: readonly CalCalendarRow[], calendarId: string): string {
  return calendars.find((c) => c.id === calendarId)?.backgroundColor || "var(--accent)";
}

export function canEditCalendar(calendars: readonly CalCalendarRow[], calendarId: string): boolean {
  const role = calendars.find((c) => c.id === calendarId)?.accessRole;
  return role === "owner" || role === "writer";
}

/** Fond teinté de la couleur de l'agenda, lisible dans les deux thèmes. */
export function eventTint(color: string, dashed = false): CSSProperties {
  return {
    background: `color-mix(in oklch, ${color} 18%, var(--surface-1))`,
    borderLeft: `3px ${dashed ? "dashed" : "solid"} ${color}`,
    color: "var(--text-primary)",
  };
}

/** Tâche liée faite, supprimée, ou ligne de note modifiée : le bloc reste comme historique. */
export function isTaskClosed(event: CalEventRow, openTaskRefs: ReadonlySet<string> | null): boolean {
  return !!event.sourceRef && !!openTaskRefs && !openTaskRefs.has(event.sourceRef);
}

interface EventBlockProps {
  event: CalEventRow;
  color: string;
  compact?: boolean;
  style?: CSSProperties;
  taskClosed?: boolean;
  onPointerDown?: (e: ReactPointerEvent<HTMLButtonElement>) => void;
  onResizeStart?: (e: ReactPointerEvent<HTMLSpanElement>) => void;
  onSelect: (el: HTMLElement) => void;
}

/**
 * Bouton natif plutôt que Button HeroUI : il porte le glisser (pointer capture)
 * et la poignée de redimensionnement, que react-aria intercepterait.
 */
export function EventBlock({ event, color, compact, style, taskClosed = false, onPointerDown, onResizeStart, onSelect }: EventBlockProps) {
  const declined = event.selfResponse === "declined";
  const awaiting = event.selfResponse === "needsAction";
  const struck = declined || taskClosed;
  return (
    <button
      type="button"
      aria-label={`${event.sourceRef ? "Tâche : " : ""}${event.summary}, ${formatSpan(event)}`}
      onPointerDown={onPointerDown}
      onClick={(e) => {
        // Le glisser appelle lui-même onSelect sans mouvement ; `detail === 0` = clavier.
        if (!onPointerDown || e.detail === 0) onSelect(e.currentTarget);
      }}
      className="group relative flex w-full min-w-0 flex-col overflow-hidden rounded-md px-1.5 py-0.5 text-left text-xs outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)]"
      style={{
        ...eventTint(color, awaiting),
        opacity: struck ? 0.5 : 1,
        ...style,
      }}
    >
      <span className="flex min-w-0 items-center gap-1">
        {event.sourceRef && <CheckSquare size={12} aria-hidden className="shrink-0" />}
        <span className={`truncate font-medium ${struck ? "line-through" : ""}`}>{event.summary}</span>
        {event.pending && <CloudArrowUp size={12} aria-label="En attente d'envoi" className="shrink-0" />}
      </span>
      {!compact && (
        <span className="truncate" style={{ color: "var(--text-secondary)" }}>
          {formatSpan(event)}
          {event.location ? ` · ${event.location}` : ""}
        </span>
      )}
      {onResizeStart && (
        <span
          aria-hidden
          onPointerDown={onResizeStart}
          className="absolute inset-x-0 bottom-0 h-2 cursor-ns-resize opacity-0 group-hover:opacity-100"
        />
      )}
    </button>
  );
}
