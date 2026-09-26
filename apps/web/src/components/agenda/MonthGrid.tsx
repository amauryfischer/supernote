"use client";

import { DAY_MS, dateKey, isSameDay } from "@/lib/agenda/dates";
import { EventBlock, calendarColor, calendarTextColor, isTaskClosed } from "./EventBlock";
import { OverlayChip } from "./OverlayChip";
import type { GridProps } from "./TimeGrid";

const MAX_ROWS = 3;
const MOBILE_MAX_ROWS = 4;
const WEEKDAYS = ["lun.", "mar.", "mer.", "jeu.", "ven.", "sam.", "dim."];
const WEEKDAY_LETTERS = ["L", "M", "M", "J", "V", "S", "D"];

interface MonthGridProps extends Omit<GridProps, "interactive" | "onMoveEvent"> {
  /** Mois affiché : les jours hors mois sont estompés. */
  month: number;
  onPickDay: (day: number) => void;
  /** Téléphone, à la Google Agenda : toute la cellule ouvre le jour, événements en barres pleines. */
  mobile?: boolean;
}

export function MonthGrid({ days, events, calendars, overlays, openTaskRefs, month, onSelectEvent, onCreateAt, onPickDay, mobile = false }: MonthGridProps) {
  const now = Date.now();
  if (mobile) return <MobileMonth days={days} events={events} calendars={calendars} overlays={overlays} openTaskRefs={openTaskRefs} month={month} onPickDay={onPickDay} now={now} />;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="grid shrink-0 grid-cols-7 border-b" style={{ borderColor: "var(--border-subtle)" }}>
        {WEEKDAYS.map((w) => (
          <div key={w} className="py-1.5 text-center text-[11px]" style={{ color: "var(--text-muted)" }}>
            {w}
          </div>
        ))}
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-7 grid-rows-6">
        {days.map((day) => {
          const key = dateKey(day);
          const items = [
            ...events
              .filter((ev) => ev.startAt < day + DAY_MS && ev.endAt > day)
              .map((ev) => ({ key: `e:${ev.id}`, node: (
                <EventBlock key={ev.id} event={ev} compact color={calendarColor(calendars, ev.calendarId)} taskClosed={isTaskClosed(ev, openTaskRefs)} onSelect={(el) => onSelectEvent(ev, el)} />
              ) })),
            ...overlays
              .filter((o) => o.date === key)
              .map((o) => ({ key: `o:${o.key}`, node: <OverlayChip key={o.key} overlay={o} showTime /> })),
          ];
          const outside = new Date(day).getMonth() !== new Date(month).getMonth();
          const today = isSameDay(day, now);
          return (
            <div
              key={day}
              className="flex min-h-0 min-w-0 flex-col gap-0.5 overflow-hidden border-b border-l p-1"
              style={{ borderColor: "var(--border-subtle)", opacity: outside ? 0.55 : 1 }}
              onDoubleClick={(e) => {
                if (e.target === e.currentTarget) onCreateAt(day + 9 * 3_600_000, day + 10 * 3_600_000, false);
              }}
            >
              <button
                type="button"
                onClick={() => onPickDay(day)}
                aria-label={`Voir le ${new Date(day).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" })}`}
                className="flex h-6 min-w-6 items-center justify-center self-start rounded-full px-1 text-xs font-semibold tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)]"
                style={today ? { background: "var(--accent)", color: "var(--accent-foreground)" } : { color: "var(--text-primary)" }}
              >
                {new Date(day).getDate()}
              </button>
              {items.slice(0, MAX_ROWS).map((it) => it.node)}
              {items.length > MAX_ROWS && (
                <button
                  type="button"
                  onClick={() => onPickDay(day)}
                  className="self-start rounded px-1 text-[11px] outline-none hover:underline focus-visible:ring-2 focus-visible:ring-[var(--border-focus)]"
                  style={{ color: "var(--text-secondary)" }}
                >
                  +{items.length - MAX_ROWS}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Cellule entière en bouton natif : grille dense de 7 colonnes où chaque jour doit
 * rester une cible tactile unique ; les barres d'événements ne sont que de l'aperçu.
 */
function MobileMonth({
  days,
  events,
  calendars,
  overlays,
  openTaskRefs,
  month,
  onPickDay,
  now,
}: Pick<MonthGridProps, "days" | "events" | "calendars" | "overlays" | "openTaskRefs" | "month" | "onPickDay"> & { now: number }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="grid shrink-0 grid-cols-7" aria-hidden>
        {WEEKDAY_LETTERS.map((w, i) => (
          <div key={i} className="py-1 text-center text-[11px] font-medium" style={{ color: "var(--text-muted)" }}>
            {w}
          </div>
        ))}
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-7 grid-rows-6 border-t" style={{ borderColor: "var(--border-subtle)" }}>
        {days.map((day) => {
          const key = dateKey(day);
          const dayEvents = events
            .filter((ev) => ev.startAt < day + DAY_MS && ev.endAt > day)
            .sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.startAt - b.startAt);
          const dayOverlays = overlays.filter((o) => o.date === key);
          const total = dayEvents.length + dayOverlays.length;
          const shown = dayEvents.slice(0, MOBILE_MAX_ROWS);
          const room = MOBILE_MAX_ROWS - shown.length;
          const outside = new Date(day).getMonth() !== new Date(month).getMonth();
          const today = isSameDay(day, now);
          const label = new Date(day).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
          return (
            <button
              key={day}
              type="button"
              onClick={() => onPickDay(day)}
              aria-label={total > 0 ? `${label}, ${total} élément${total > 1 ? "s" : ""}` : label}
              className="flex min-h-0 min-w-0 flex-col items-stretch gap-px overflow-hidden border-b border-r px-px pb-0.5 pt-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--border-focus)]"
              style={{ borderColor: "var(--border-subtle)" }}
            >
              <span
                className="mx-auto mb-0.5 flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-xs tabular-nums"
                style={
                  today
                    ? { background: "var(--accent)", color: "var(--accent-foreground)", fontWeight: 600 }
                    : { color: outside ? "var(--text-muted)" : "var(--text-primary)" }
                }
              >
                {new Date(day).getDate()}
              </span>
              {shown.map((ev) => {
                const color = calendarColor(calendars, ev.calendarId);
                const awaiting = ev.selfResponse === "needsAction";
                const struck = ev.selfResponse === "declined" || isTaskClosed(ev, openTaskRefs);
                return (
                  <span
                    key={ev.id}
                    aria-hidden
                    className={`block truncate rounded-sm px-0.5 text-[10px] leading-[14px] ${struck ? "line-through" : ""}`}
                    style={{
                      ...(awaiting
                        ? { boxShadow: `inset 0 0 0 1px ${color}`, color: "var(--text-primary)" }
                        : { background: color, color: calendarTextColor(calendars, ev.calendarId) }),
                      opacity: struck || outside ? 0.55 : 1,
                    }}
                  >
                    {ev.summary}
                  </span>
                );
              })}
              {dayOverlays.slice(0, Math.max(0, room)).map((o) => (
                <span
                  key={o.key}
                  aria-hidden
                  className="block truncate rounded-sm px-0.5 text-[10px] leading-[14px]"
                  style={{ color: "var(--text-secondary)", boxShadow: "inset 0 0 0 1px var(--border)" }}
                >
                  {o.title}
                </span>
              ))}
              {total > MOBILE_MAX_ROWS && (
                <span aria-hidden className="px-0.5 text-[10px] leading-[14px]" style={{ color: "var(--text-secondary)" }}>
                  +{total - MOBILE_MAX_ROWS}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
