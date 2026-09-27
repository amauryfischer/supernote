"use client";

import { useState } from "react";
import {
  ArrowsClockwise,
  CalendarBlank,
  CaretDown,
  CaretLeft,
  CaretRight,
  Check,
  CloudArrowUp,
  Columns,
  DotsThree,
  ListBullets,
  PauseCircle,
  Rows,
  SquaresFour,
  type Icon,
} from "@phosphor-icons/react";
import { Button, DropdownMenu, Tooltip } from "@supernote/ui";
import { formatMonthTitle, formatRangeTitle, type AgendaView } from "@/lib/agenda/dates";
import type { CalCalendarRow } from "@supernote/ipc";
import type { CalendarListPatch } from "@/lib/gcal";
import type { OverlaySource } from "./useAgendaData";
import { CalendarsPopover } from "./CalendarsPopover";
import { MiniMonth } from "./MiniMonth";

export const SOURCE_LABELS: Record<OverlaySource, string> = {
  todos: "Todos",
  mail: "Reports mail",
  bases: "Bases",
};

export const VIEW_LABELS: Record<AgendaView, string> = {
  list: "Planning",
  day: "Jour",
  "3day": "3 jours",
  week: "Semaine",
  month: "Mois",
};

const VIEW_ICONS: Record<AgendaView, Icon> = {
  list: ListBullets,
  day: Rows,
  "3day": Columns,
  week: CalendarBlank,
  month: SquaresFour,
};

interface AgendaToolbarProps {
  view: AgendaView;
  anchor: number;
  isMobile: boolean;
  onView: (v: AgendaView) => void;
  onNavigate: (dir: -1 | 0 | 1) => void;
  /** Saut direct à un jour (mini-calendrier du téléphone). */
  onJump: (day: number) => void;
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
  view, anchor, isMobile, onView, onNavigate, onJump, syncPaused, onResume, pendingCount, onSyncNow, onDisconnect, sources, onToggleSource, calendars, onCalendarChange,
}: AgendaToolbarProps) {
  const sourceKeys = Object.keys(SOURCE_LABELS) as OverlaySource[];
  const [pickerOpen, setPickerOpen] = useState(false);
  const moreMenu = (
    <DropdownMenu
      trigger={
        <Button variant="ghost" size="icon" isIconOnly aria-label="Plus d'actions de l'agenda" className={isMobile ? "h-10 w-10" : undefined}>
          <DotsThree size={isMobile ? 20 : 18} aria-hidden />
        </Button>
      }
      items={[
        ...(isMobile
          ? sourceKeys.map((k) => ({
              key: `source-${k}`,
              label: `${sources[k] ? "Masquer" : "Afficher"} : ${SOURCE_LABELS[k].toLowerCase()}`,
              onPress: () => onToggleSource(k),
            }))
          : []),
        { key: "sync", label: "Synchroniser maintenant", startContent: <ArrowsClockwise size={14} aria-hidden />, onPress: onSyncNow, separator: isMobile },
        { key: "disconnect", label: "Déconnecter l'agenda", onPress: onDisconnect, isDanger: true, separator: true },
      ]}
    />
  );

  if (isMobile) {
    const ViewIcon = VIEW_ICONS[view];
    const today = new Date().getDate();
    return (
      <div className="shrink-0 border-b px-2" style={{ borderColor: "var(--border-subtle)" }}>
        <div className="flex h-12 items-center gap-0.5">
          <Button
            variant="ghost"
            aria-expanded={pickerOpen}
            aria-label={`${formatRangeTitle(view, anchor)} · ${pickerOpen ? "masquer" : "afficher"} le calendrier`}
            onPress={() => setPickerOpen((o) => !o)}
            className="h-10 min-w-0 gap-1 px-2 text-lg font-semibold capitalize"
            style={{ color: "var(--text-primary)" }}
          >
            <span className="truncate">{formatMonthTitle(anchor)}</span>
            <CaretDown
              size={14}
              aria-hidden
              className="shrink-0 transition-transform"
              style={{ transform: pickerOpen ? "rotate(180deg)" : undefined }}
            />
          </Button>
          <div className="min-w-0 flex-1" />
          {pendingCount > 0 && (
            <span className="flex items-center gap-1 px-1 text-xs" style={{ color: "var(--text-secondary)" }} aria-label={`${pendingCount} en attente d'envoi`}>
              <CloudArrowUp size={16} aria-hidden />
              {pendingCount}
            </span>
          )}
          <Button variant="ghost" size="icon" isIconOnly aria-label="Aujourd'hui" className="relative h-10 w-10" onPress={() => onNavigate(0)}>
            <CalendarBlank size={24} aria-hidden />
            <span aria-hidden className="absolute inset-x-0 top-[17px] text-center text-[10px] font-bold leading-none tabular-nums">
              {today}
            </span>
          </Button>
          <DropdownMenu
            trigger={
              <Button variant="ghost" size="icon" isIconOnly aria-label={`Vue : ${VIEW_LABELS[view]}`} className="h-10 w-10">
                <ViewIcon size={20} aria-hidden />
              </Button>
            }
            items={(Object.keys(VIEW_LABELS) as AgendaView[]).map((v) => {
              const ItemIcon = VIEW_ICONS[v];
              return {
                key: `view-${v}`,
                label: VIEW_LABELS[v],
                startContent: <ItemIcon size={16} aria-hidden />,
                endContent: view === v ? <Check size={14} aria-hidden /> : undefined,
                onPress: () => onView(v),
              };
            })}
          />
          <CalendarsPopover calendars={calendars} onChange={onCalendarChange} />
          {moreMenu}
        </div>
        {syncPaused && (
          <div className="pb-2">
            <Button variant="outline" size="sm" className="w-full" onPress={onResume}>
              <PauseCircle size={14} aria-hidden />
              Synchro en pause · Reprendre
            </Button>
          </div>
        )}
        {pickerOpen && (
          <MiniMonth
            selected={anchor}
            onPick={(day) => {
              onJump(day);
              setPickerOpen(false);
            }}
          />
        )}
      </div>
    );
  }

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

      {moreMenu}
    </div>
  );
}
