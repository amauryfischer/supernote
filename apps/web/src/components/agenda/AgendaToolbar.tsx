"use client";

import { ArrowsClockwise, CaretLeft, CaretRight, CloudArrowUp, DotsThree, PauseCircle } from "@phosphor-icons/react";
import { Button, DropdownMenu, Tooltip } from "@supernote/ui";
import { formatRangeTitle, type AgendaView } from "@/lib/agenda/dates";
import type { CalCalendarRow } from "@supernote/ipc";
import type { CalendarListPatch } from "@/lib/gcal";
import type { OverlaySource } from "./useAgendaData";
import { CalendarsPopover } from "./CalendarsPopover";

export const SOURCE_LABELS: Record<OverlaySource, string> = {
  todos: "Todos",
  mail: "Reports mail",
  bases: "Bases",
};

export const VIEW_LABELS: Record<AgendaView, string> = {
  day: "Jour",
  week: "Semaine",
  month: "Mois",
  list: "Liste",
};

interface AgendaToolbarProps {
  view: AgendaView;
  anchor: number;
  isMobile: boolean;
  onView: (v: AgendaView) => void;
  onNavigate: (dir: -1 | 0 | 1) => void;
  /** Connecté, mais plus de jeton en cache : la synchro attend un geste. */
  syncPaused: boolean;
  onResume: () => void;
  pendingCount: number;
  onSyncNow: () => void;
  onDisconnect: () => void;
  sources: Record<OverlaySource, boolean>;
  onToggleSource: (s: OverlaySource) => void;
  calendars: CalCalendarRow[];
  onCalendarChange: (calendarId: string, patch: CalendarListPatch) => void;
}

export function AgendaToolbar({
  view, anchor, isMobile, onView, onNavigate, syncPaused, onResume, pendingCount, onSyncNow, onDisconnect, sources, onToggleSource, calendars, onCalendarChange,
}: AgendaToolbarProps) {
  const sourceKeys = Object.keys(SOURCE_LABELS) as OverlaySource[];
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-4 py-2 md:px-6" style={{ borderColor: "var(--border-subtle)" }}>
      <Button variant="outline" size="sm" onPress={() => onNavigate(0)}>
        Aujourd'hui
      </Button>
      <div className="flex items-center">
        <Tooltip content="Précédent">
          <Button variant="ghost" size="icon" isIconOnly aria-label="Période précédente" onPress={() => onNavigate(-1)}>
            <CaretLeft size={16} aria-hidden />
          </Button>
        </Tooltip>
        <Tooltip content="Suivant">
          <Button variant="ghost" size="icon" isIconOnly aria-label="Période suivante" onPress={() => onNavigate(1)}>
            <CaretRight size={16} aria-hidden />
          </Button>
        </Tooltip>
      </div>
      <h1 className="min-w-0 flex-1 truncate text-base font-semibold capitalize" style={{ color: "var(--text-primary)" }}>
        {formatRangeTitle(view, anchor)}
      </h1>

      {pendingCount > 0 && (
        <span className="flex items-center gap-1 text-xs" style={{ color: "var(--text-secondary)" }}>
          <CloudArrowUp size={14} aria-hidden />
          {pendingCount} en attente
        </span>
      )}
      {syncPaused && (
        <Button variant="outline" size="sm" onPress={onResume}>
          <PauseCircle size={14} aria-hidden />
          Synchro en pause · Reprendre
        </Button>
      )}

      {!isMobile && (
        <div role="group" aria-label="Afficher aussi" className="flex shrink-0 gap-1">
          {sourceKeys.map((k) => (
            <Button
              key={k}
              size="sm"
              variant="ghost"
              aria-pressed={sources[k]}
              onPress={() => onToggleSource(k)}
              className="h-7 rounded-full border px-2.5 text-xs"
              style={
                sources[k]
                  ? { borderColor: "var(--border)", color: "var(--text-primary)", background: "var(--surface-2)" }
                  : { borderColor: "var(--border-subtle)", color: "var(--text-muted)" }
              }
            >
              {SOURCE_LABELS[k]}
            </Button>
          ))}
        </div>
      )}

      {!isMobile && (
        <div role="group" aria-label="Vue" className="flex shrink-0 gap-0.5 rounded-lg border p-0.5" style={{ borderColor: "var(--border-subtle)" }}>
          {(Object.keys(VIEW_LABELS) as AgendaView[]).map((v) => (
            <Button
              key={v}
              size="sm"
              variant="ghost"
              aria-pressed={view === v}
              onPress={() => onView(v)}
              className="h-7 px-2.5"
              style={view === v ? { background: "var(--surface-2)", color: "var(--text-primary)" } : { color: "var(--text-secondary)" }}
            >
              {VIEW_LABELS[v]}
            </Button>
          ))}
        </div>
      )}

      <CalendarsPopover calendars={calendars} onChange={onCalendarChange} />

      <DropdownMenu
        trigger={
          <Button variant="ghost" size="icon" isIconOnly aria-label="Plus d'actions de l'agenda">
            <DotsThree size={18} aria-hidden />
          </Button>
        }
        items={[
          ...(isMobile
            ? (Object.keys(VIEW_LABELS) as AgendaView[]).map((v) => ({
                key: `view-${v}`,
                label: `Vue ${VIEW_LABELS[v].toLowerCase()}`,
                onPress: () => onView(v),
              }))
            : []),
          ...(isMobile
            ? sourceKeys.map((k, i) => ({
                key: `source-${k}`,
                label: `${sources[k] ? "Masquer" : "Afficher"} : ${SOURCE_LABELS[k].toLowerCase()}`,
                onPress: () => onToggleSource(k),
                separator: i === 0,
              }))
            : []),
          { key: "sync", label: "Synchroniser maintenant", startContent: <ArrowsClockwise size={14} aria-hidden />, onPress: onSyncNow },
          { key: "disconnect", label: "Déconnecter l'agenda", onPress: onDisconnect, isDanger: true, separator: true },
        ]}
      />
    </div>
  );
}
