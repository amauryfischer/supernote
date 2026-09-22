"use client";

import { DAY_MS, dateKey, isSameDay } from "@/lib/agenda/dates";
import { EventBlock, calendarColor } from "./EventBlock";
import { OverlayChip } from "./OverlayChip";
import type { GridProps } from "./TimeGrid";

const MAX_ROWS = 3;
const WEEKDAYS = ["lun.", "mar.", "mer.", "jeu.", "ven.", "sam.", "dim."];

interface MonthGridProps extends Omit<GridProps, "interactive" | "onMoveEvent"> {
  /** Mois affiché : les jours hors mois sont estompés. */
  month: number;
  onPickDay: (day: number) => void;
}

export function MonthGrid({ days, events, calendars, overlays, month, onSelectEvent, onCreateAt, onPickDay }: MonthGridProps) {
  const now = Date.now();
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
                <EventBlock key={ev.id} event={ev} compact color={calendarColor(calendars, ev.calendarId)} onSelect={(el) => onSelectEvent(ev, el)} />
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
