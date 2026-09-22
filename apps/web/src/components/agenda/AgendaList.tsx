"use client";

import { CalendarBlank } from "@phosphor-icons/react";
import { EmptyState } from "@supernote/ui";
import { DAY_MS, dateKey, formatDayLong, formatSpan, isSameDay } from "@/lib/agenda/dates";
import { calendarColor } from "./EventBlock";
import { OverlayChip } from "./OverlayChip";
import type { GridProps } from "./TimeGrid";

type ListProps = Omit<GridProps, "interactive" | "onMoveEvent" | "onCreateAt">;

/** Vue par défaut au téléphone : jours qui ont quelque chose, lignes de 44 px. */
export function AgendaList({ days, events, calendars, overlays, onSelectEvent }: ListProps) {
  const now = Date.now();
  const groups = days
    .map((day) => {
      const key = dateKey(day);
      return {
        day,
        events: events.filter((ev) => ev.startAt < day + DAY_MS && ev.endAt > day),
        overlays: overlays.filter((o) => o.date === key),
      };
    })
    .filter((g) => g.events.length > 0 || g.overlays.length > 0 || isSameDay(g.day, now));

  if (groups.every((g) => g.events.length === 0 && g.overlays.length === 0)) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <EmptyState icon={<CalendarBlank size={28} aria-hidden />} title="Rien de prévu" description="Aucun événement sur les deux prochaines semaines." />
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-24 md:px-6">
      {groups.map((g) => (
        <section key={g.day} className="pt-3">
          <h2
            className="sn-eyebrow sn-eyebrow--compact sticky top-0 z-10 py-1.5 capitalize"
            style={{ background: "var(--surface-0)" }}
          >
            {isSameDay(g.day, now) ? `Aujourd'hui · ${formatDayLong(g.day)}` : formatDayLong(g.day)}
          </h2>
          {g.events.length === 0 && g.overlays.length === 0 && (
            <p className="py-2 text-sm" style={{ color: "var(--text-muted)" }}>
              Rien de prévu
            </p>
          )}
          <ul className="flex flex-col">
            {g.events.map((ev) => (
              <li key={ev.id}>
                <button
                  type="button"
                  onClick={(e) => onSelectEvent(ev, e.currentTarget)}
                  className="flex min-h-11 w-full items-center gap-3 rounded-md px-2 text-left outline-none transition-colors hover:bg-[var(--nav-hover-bg)] focus-visible:ring-2 focus-visible:ring-[var(--border-focus)]"
                >
                  <span className="w-24 shrink-0 text-xs tabular-nums" style={{ color: "var(--text-secondary)" }}>
                    {formatSpan(ev)}
                  </span>
                  <span
                    aria-hidden
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ background: calendarColor(calendars, ev.calendarId) }}
                  />
                  <span className="min-w-0 flex-1">
                    <span
                      className={`block truncate text-sm ${ev.selfResponse === "declined" ? "line-through" : ""}`}
                      style={{ color: "var(--text-primary)" }}
                    >
                      {ev.summary}
                    </span>
                    {ev.location && (
                      <span className="block truncate text-xs" style={{ color: "var(--text-muted)" }}>
                        {ev.location}
                      </span>
                    )}
                  </span>
                </button>
              </li>
            ))}
            {g.overlays.map((o) => (
              <li key={o.key} className="py-1">
                <OverlayChip overlay={o} showTime />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
