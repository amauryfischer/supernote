"use client";

import { CalendarBlank, CheckSquare, CloudArrowUp } from "@phosphor-icons/react";
import type { CalEventRow } from "@supernote/ipc";
import { Button, EmptyState } from "@supernote/ui";
import { DAY_MS, dateKey, formatSpan, formatWeekSpan, isSameDay, startOfWeek } from "@/lib/agenda/dates";
import { calendarColor, calendarTextColor, eventSolid, isTaskClosed } from "./EventBlock";
import { OverlayChip } from "./OverlayChip";
import type { GridProps } from "./TimeGrid";

type ListProps = Omit<GridProps, "interactive" | "onMoveEvent" | "onCreateAt"> & {
  /** Planning suivant : le bas de liste enchaîne plutôt que de s'arrêter net. */
  onMore?: () => void;
};

const WEEKDAY = new Intl.DateTimeFormat("fr-FR", { weekday: "short" });
const MONTH_YEAR = new Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric" });

const byStart = (a: CalEventRow, b: CalEventRow) => Number(b.allDay) - Number(a.allDay) || a.startAt - b.startAt;

/**
 * Planning à la Google Agenda : date en colonne à gauche, pastilles pleines de la
 * couleur de l'agenda, en-têtes de mois et de semaine, ligne « maintenant ».
 * Vue par défaut au téléphone.
 */
export function AgendaList({ days, events, calendars, overlays, openTaskRefs, onSelectEvent, onMore }: ListProps) {
  const now = Date.now();
  const groups = days
    .map((day) => {
      const key = dateKey(day);
      return {
        day,
        events: events.filter((ev) => ev.startAt < day + DAY_MS && ev.endAt > day).sort(byStart),
        overlays: overlays.filter((o) => o.date === key),
      };
    })
    .filter((g) => g.events.length > 0 || g.overlays.length > 0 || isSameDay(g.day, now));

  if (groups.every((g) => g.events.length === 0 && g.overlays.length === 0)) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6">
        <EmptyState icon={<CalendarBlank size={28} aria-hidden />} title="Rien de prévu" description="Aucun événement sur les deux prochaines semaines." />
        {onMore && (
          <Button variant="outline" size="sm" onPress={onMore}>
            Semaines suivantes
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-28 md:px-6">
      {groups.map((g, i) => {
        const prev = groups[i - 1];
        const newMonth = !prev || new Date(prev.day).getMonth() !== new Date(g.day).getMonth();
        const newWeek = !prev || startOfWeek(prev.day) !== startOfWeek(g.day);
        const today = isSameDay(g.day, now);
        // Ligne « maintenant » : avant le premier événement minuté d'aujourd'hui qui n'a pas commencé.
        const nowIndex = today ? g.events.findIndex((ev) => !ev.allDay && ev.startAt > now) : -2;
        const nowAt = nowIndex === -1 ? g.events.length : nowIndex;
        return (
          <section key={g.day} aria-label={new Date(g.day).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" })}>
            {newMonth && (
              <h2 className="px-2 pb-1 pt-5 text-lg font-semibold capitalize" style={{ color: "var(--text-primary)" }}>
                {MONTH_YEAR.format(g.day)}
              </h2>
            )}
            {newWeek && (
              <p className="pb-1 pl-[60px] pt-3 text-xs" style={{ color: "var(--text-muted)" }}>
                {formatWeekSpan(startOfWeek(g.day))}
              </p>
            )}
            <div className="grid grid-cols-[52px_minmax(0,1fr)] gap-x-2 py-1.5">
              <div className="flex flex-col items-center pt-0.5" aria-hidden>
                <span
                  className="text-[11px] font-medium uppercase"
                  style={{ color: today ? "var(--accent)" : "var(--text-secondary)" }}
                >
                  {WEEKDAY.format(g.day)}
                </span>
                <span
                  className="flex h-9 w-9 items-center justify-center rounded-full text-xl tabular-nums"
                  style={today ? { background: "var(--accent)", color: "var(--accent-foreground)" } : { color: "var(--text-primary)" }}
                >
                  {new Date(g.day).getDate()}
                </span>
              </div>
              <ul className="flex min-w-0 flex-col gap-1 pt-1">
                {g.events.length === 0 && g.overlays.length === 0 && (
                  <li className="flex min-h-11 items-center px-3 text-sm" style={{ color: "var(--text-muted)" }}>
                    Rien de prévu aujourd'hui
                  </li>
                )}
                {g.events.map((ev, idx) => (
                  <li key={ev.id} className="flex flex-col gap-1">
                    {idx === nowAt && <NowLine />}
                    <ScheduleCard
                      event={ev}
                      color={calendarColor(calendars, ev.calendarId)}
                      textColor={calendarTextColor(calendars, ev.calendarId)}
                      taskClosed={isTaskClosed(ev, openTaskRefs)}
                      onSelect={(el) => onSelectEvent(ev, el)}
                    />
                  </li>
                ))}
                {today && nowAt === g.events.length && g.events.length > 0 && (
                  <li>
                    <NowLine />
                  </li>
                )}
                {g.overlays.map((o) => (
                  <li key={o.key}>
                    <OverlayChip overlay={o} showTime roomy />
                  </li>
                ))}
              </ul>
            </div>
          </section>
        );
      })}
      {onMore && (
        <div className="flex justify-center pt-4">
          <Button variant="outline" size="sm" onPress={onMore}>
            Semaines suivantes
          </Button>
        </div>
      )}
    </div>
  );
}

function NowLine() {
  return (
    <span aria-hidden className="relative my-0.5 block h-0.5 rounded-full" style={{ background: "var(--danger)" }}>
      <span className="absolute -left-1 -top-[3px] h-2 w-2 rounded-full" style={{ background: "var(--danger)" }} />
    </span>
  );
}

/**
 * Bouton natif : pastille pleine de hauteur libre, que les styles non layerés du
 * Button HeroUI (hauteur fixe, centrage) écraseraient.
 */
function ScheduleCard({
  event,
  color,
  textColor,
  taskClosed,
  onSelect,
}: {
  event: CalEventRow;
  color: string;
  textColor: string;
  taskClosed: boolean;
  onSelect: (el: HTMLElement) => void;
}) {
  const struck = event.selfResponse === "declined" || taskClosed;
  const awaiting = event.selfResponse === "needsAction";
  return (
    <button
      type="button"
      aria-label={`${event.sourceRef ? "Tâche : " : ""}${event.summary}, ${formatSpan(event)}`}
      onClick={(e) => onSelect(e.currentTarget)}
      className="flex min-h-11 w-full min-w-0 flex-col justify-center rounded-lg px-3 py-1.5 text-left outline-none transition-[filter] hover:brightness-95 focus-visible:ring-2 focus-visible:ring-[var(--border-focus)] focus-visible:ring-offset-1"
      style={{ ...eventSolid(color, textColor, awaiting || struck), opacity: struck ? 0.6 : 1 }}
    >
      <span className={`flex min-w-0 items-center gap-1 text-sm font-medium ${struck ? "line-through" : ""}`}>
        {event.sourceRef && <CheckSquare size={14} aria-hidden className="shrink-0" />}
        <span className="truncate">{event.summary}</span>
        {event.pending && <CloudArrowUp size={14} aria-label="En attente d'envoi" className="shrink-0" />}
      </span>
      {!event.allDay && (
        <span className="truncate text-xs" style={{ opacity: 0.85 }}>
          {formatSpan(event)}
          {event.location ? ` · ${event.location}` : ""}
        </span>
      )}
      {event.allDay && event.location && (
        <span className="truncate text-xs" style={{ opacity: 0.85 }}>
          {event.location}
        </span>
      )}
    </button>
  );
}
