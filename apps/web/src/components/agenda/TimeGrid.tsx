"use client";

import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from "react";
import type { CalCalendarRow, CalEventRow } from "@supernote/ipc";
import { DAY_MS, addDays, dateKey, isSameDay, minutesOfDay } from "@/lib/agenda/dates";
import { layoutDay } from "@/lib/agenda/layout";
import { EventBlock, calendarColor, canEditCalendar, eventTint } from "./EventBlock";
import { OverlayChip } from "./OverlayChip";
import type { AgendaOverlay } from "./useAgendaData";

const PX_PER_MIN = 0.8;
const SNAP_MIN = 15;
const DRAG_THRESHOLD_PX = 4;
const HOURS = Array.from({ length: 24 }, (_, h) => h);
const WEEKDAY = new Intl.DateTimeFormat("fr-FR", { weekday: "short" });

export interface GridProps {
  days: number[];
  events: CalEventRow[];
  calendars: CalCalendarRow[];
  overlays: AgendaOverlay[];
  /** Glisser pour créer, déplacer, redimensionner : ordinateur seulement. */
  interactive: boolean;
  onSelectEvent: (ev: CalEventRow, anchor: HTMLElement) => void;
  onCreateAt: (startAt: number, endAt: number, allDay: boolean) => void;
  onMoveEvent: (ev: CalEventRow, startAt: number, endAt: number) => void;
}

type Drag =
  | { kind: "move" | "resize"; ev: CalEventRow; el: HTMLElement; x0: number; y0: number; day0: number; startAt: number; endAt: number; moved: boolean }
  | { kind: "create"; day: number; fromMin: number; toMin: number };

const snap = (min: number) => Math.round(min / SNAP_MIN) * SNAP_MIN;
const clampMin = (min: number) => Math.min(24 * 60, Math.max(0, min));

function overlapsDay(ev: CalEventRow, day: number): boolean {
  return ev.startAt < day + DAY_MS && ev.endAt > day;
}

export function TimeGrid({ days, events, calendars, overlays, interactive, onSelectEvent, onCreateAt, onMoveEvent }: GridProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const columnsRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  // Premier affichage : la matinée, ou l'heure courante si aujourd'hui est visible.
  const firstDay = days[0] ?? 0;
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const today = days.some((d) => isSameDay(d, Date.now()));
    const targetMin = today ? Math.max(0, minutesOfDay(Date.now()) - 90) : 7.5 * 60;
    el.scrollTop = targetMin * PX_PER_MIN;
  }, [firstDay]); // eslint-disable-line react-hooks/exhaustive-deps

  const timed = useMemo(() => events.filter((e) => !e.allDay), [events]);
  const allDay = useMemo(() => events.filter((e) => e.allDay), [events]);

  const pointerMinute = (clientY: number) => {
    const rect = bodyRef.current?.getBoundingClientRect();
    return rect ? clampMin((clientY - rect.top) / PX_PER_MIN) : 0;
  };
  const pointerDay = (clientX: number) => {
    const rect = columnsRef.current?.getBoundingClientRect();
    if (!rect) return 0;
    return Math.min(days.length - 1, Math.max(0, Math.floor(((clientX - rect.left) / rect.width) * days.length)));
  };

  const update = (next: Drag | null) => {
    dragRef.current = next;
    setDrag(next);
  };

  useEffect(() => {
    if (!drag) return undefined;
    const onMove = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      if (d.kind === "create") {
        update({ ...d, toMin: snap(pointerMinute(e.clientY)) });
        return;
      }
      const moved = d.moved || Math.abs(e.clientX - d.x0) > DRAG_THRESHOLD_PX || Math.abs(e.clientY - d.y0) > DRAG_THRESHOLD_PX;
      const deltaMin = snap((e.clientY - d.y0) / PX_PER_MIN);
      if (d.kind === "move") {
        const deltaDays = pointerDay(e.clientX) - d.day0;
        const startAt = addDays(d.ev.startAt, deltaDays) + deltaMin * 60_000;
        update({ ...d, moved, startAt, endAt: startAt + (d.ev.endAt - d.ev.startAt) });
      } else {
        const endAt = Math.max(d.ev.startAt + SNAP_MIN * 60_000, d.ev.endAt + deltaMin * 60_000);
        update({ ...d, moved, endAt });
      }
    };
    const onUp = () => {
      const d = dragRef.current;
      update(null);
      if (!d) return;
      if (d.kind === "create") {
        const from = Math.min(d.fromMin, d.toMin);
        const to = Math.max(d.fromMin, d.toMin);
        const day = days[d.day] ?? firstDay;
        const startAt = day + from * 60_000;
        onCreateAt(startAt, to - from >= SNAP_MIN ? day + to * 60_000 : startAt + 60 * 60_000, false);
      } else if (d.moved) {
        onMoveEvent(d.ev, d.startAt, d.endAt);
      } else {
        onSelectEvent(d.ev, d.el);
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [drag !== null]); // eslint-disable-line react-hooks/exhaustive-deps

  const startEventDrag = (kind: "move" | "resize", ev: CalEventRow, e: ReactPointerEvent<HTMLElement>, el: HTMLElement) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    update({ kind, ev, el, x0: e.clientX, y0: e.clientY, day0: pointerDay(e.clientX), startAt: ev.startAt, endAt: ev.endAt, moved: false });
  };

  const onColumnPointerDown = (dayIndex: number, e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget || e.button !== 0) return;
    if (!interactive) return;
    const min = snap(pointerMinute(e.clientY));
    update({ kind: "create", day: dayIndex, fromMin: min, toMin: min });
  };

  const onColumnClick = (day: number, e: ReactMouseEvent<HTMLDivElement>) => {
    // Au doigt : un tap sur un créneau libre propose un événement d'une heure.
    if (interactive || e.target !== e.currentTarget) return;
    const startAt = day + snap(pointerMinute(e.clientY)) * 60_000;
    onCreateAt(startAt, startAt + 60 * 60_000, false);
  };

  const cols = `3rem repeat(${days.length}, minmax(0, 1fr))`;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* En-têtes de jours */}
      <div className="grid shrink-0 border-b" style={{ gridTemplateColumns: cols, borderColor: "var(--border-subtle)" }}>
        <div />
        {days.map((day) => {
          const today = isSameDay(day, now);
          return (
            <div key={day} className="flex flex-col items-center py-1.5">
              <span className="text-[11px] capitalize" style={{ color: "var(--text-muted)" }}>
                {WEEKDAY.format(day)}
              </span>
              <span
                className="flex h-7 min-w-7 items-center justify-center rounded-full px-1 text-sm font-semibold tabular-nums"
                style={today ? { background: "var(--accent)", color: "var(--accent-foreground)" } : { color: "var(--text-primary)" }}
              >
                {new Date(day).getDate()}
              </span>
            </div>
          );
        })}
      </div>

      {/* Bande « toute la journée » : événements sur la journée, todos, dates de bases */}
      <div className="grid shrink-0 border-b" style={{ gridTemplateColumns: cols, borderColor: "var(--border-subtle)" }}>
        <div className="flex items-start justify-end px-1 pt-1 text-[10px]" style={{ color: "var(--text-muted)" }}>
          Journée
        </div>
        {days.map((day) => {
          const key = dateKey(day);
          const dayEvents = allDay.filter((ev) => overlapsDay(ev, day));
          const dayOverlays = overlays.filter((o) => o.date === key && o.atMs === null);
          return (
            <div
              key={day}
              className="flex min-h-7 min-w-0 flex-col gap-0.5 border-l p-0.5"
              style={{ borderColor: "var(--border-subtle)" }}
              onDoubleClick={(e) => {
                if (e.target === e.currentTarget) onCreateAt(day, day + DAY_MS, true);
              }}
            >
              {dayEvents.map((ev) => (
                <EventBlock
                  key={ev.id}
                  event={ev}
                  compact
                  color={calendarColor(calendars, ev.calendarId)}
                  onSelect={(el) => onSelectEvent(ev, el)}
                />
              ))}
              {dayOverlays.map((o) => (
                <OverlayChip key={o.key} overlay={o} />
              ))}
            </div>
          );
        })}
      </div>

      {/* Colonnes horaires */}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        <div className="grid" style={{ gridTemplateColumns: cols }}>
          <div className="relative" style={{ height: 24 * 60 * PX_PER_MIN }}>
            {HOURS.map((h) => (
              <span
                key={h}
                className="absolute right-1 -translate-y-1/2 text-[10px] tabular-nums"
                style={{ top: h * 60 * PX_PER_MIN, color: "var(--text-muted)" }}
              >
                {h === 0 ? "" : `${String(h).padStart(2, "0")}:00`}
              </span>
            ))}
          </div>
          <div
            ref={columnsRef}
            className="relative grid"
            style={{ gridColumn: `2 / span ${days.length}`, gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))` }}
          >
            <div ref={bodyRef} className="pointer-events-none absolute inset-0" aria-hidden>
              {HOURS.map((h) => (
                <div
                  key={h}
                  className="absolute inset-x-0 border-t"
                  style={{ top: h * 60 * PX_PER_MIN, borderColor: "var(--border-subtle)" }}
                />
              ))}
            </div>
            {days.map((day, dayIndex) => {
              const dayTimed = timed
                .filter((ev) => overlapsDay(ev, day))
                .map((ev) =>
                  drag && drag.kind !== "create" && drag.ev.id === ev.id ? { ...ev, startAt: drag.startAt, endAt: drag.endAt } : ev,
                )
                .filter((ev) => overlapsDay(ev, day));
              const placed = layoutDay(dayTimed, day, PX_PER_MIN);
              const timedOverlays = overlays.filter((o) => o.atMs !== null && isSameDay(o.atMs, day));
              const showNow = isSameDay(day, now);
              return (
                <div
                  key={day}
                  className="relative border-l"
                  style={{ height: 24 * 60 * PX_PER_MIN, borderColor: "var(--border-subtle)", cursor: interactive ? "cell" : undefined }}
                  onPointerDown={(e) => onColumnPointerDown(dayIndex, e)}
                  onClick={(e) => onColumnClick(day, e)}
                >
                  {placed.map((p) => {
                    const editable = interactive && canEditCalendar(calendars, p.item.calendarId);
                    return (
                      <div
                        key={p.item.id}
                        className="absolute px-px"
                        style={{
                          top: p.top,
                          height: Math.max(p.height, 18),
                          left: `${(p.column / p.columns) * 100}%`,
                          width: `${100 / p.columns}%`,
                        }}
                      >
                        <EventBlock
                          event={p.item}
                          compact={p.height < 36}
                          color={calendarColor(calendars, p.item.calendarId)}
                          style={{ height: "100%" }}
                          onSelect={(el) => onSelectEvent(p.item, el)}
                          {...(editable
                            ? {
                                onPointerDown: (e: ReactPointerEvent<HTMLButtonElement>) =>
                                  startEventDrag("move", p.item, e, e.currentTarget),
                                onResizeStart: (e: ReactPointerEvent<HTMLSpanElement>) =>
                                  startEventDrag("resize", p.item, e, e.currentTarget.parentElement ?? e.currentTarget),
                              }
                            : {})}
                        />
                      </div>
                    );
                  })}
                  {timedOverlays.map((o) => (
                    <div
                      key={o.key}
                      className="absolute right-0.5 z-10 max-w-[80%]"
                      style={{ top: minutesOfDay(o.atMs ?? 0) * PX_PER_MIN, background: "var(--surface-0)" }}
                    >
                      <OverlayChip overlay={o} showTime />
                    </div>
                  ))}
                  {drag?.kind === "create" && drag.day === dayIndex && (
                    <div
                      className="pointer-events-none absolute inset-x-0.5 rounded-md"
                      style={{
                        ...eventTint("var(--accent)"),
                        top: Math.min(drag.fromMin, drag.toMin) * PX_PER_MIN,
                        height: Math.max(Math.abs(drag.toMin - drag.fromMin), SNAP_MIN) * PX_PER_MIN,
                      }}
                    />
                  )}
                  {showNow && (
                    <div
                      aria-hidden
                      className="pointer-events-none absolute inset-x-0 z-20 h-0.5"
                      style={{ top: minutesOfDay(now) * PX_PER_MIN, background: "var(--danger)" }}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

