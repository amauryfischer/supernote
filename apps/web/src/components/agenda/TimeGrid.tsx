"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type { CalCalendarRow, CalEventRow } from "@supernote/ipc";
import { DAY_MS, addDays, dateKey, isSameDay, minutesOfDay } from "@/lib/agenda/dates";
import { layoutDay } from "@/lib/agenda/layout";
import { TASK_DRAG_MIME } from "@/lib/agenda/task-ref";
import { SLOT_MIN } from "@/lib/agenda/free-slots";
import { EventBlock, calendarColor, calendarTextColor, canEditCalendar, eventTint, isTaskClosed } from "./EventBlock";
import { OverlayChip } from "./OverlayChip";
import type { AgendaOverlay } from "./useAgendaData";

const DESKTOP_PX_PER_MIN = 0.8;
/** 60 px l'heure au doigt, comme Google Agenda : un créneau d'une demi-heure reste tapable. */
const MOBILE_PX_PER_MIN = 1;
const SNAP_MIN = 15;
const DRAG_THRESHOLD_PX = 4;
const HOURS = Array.from({ length: 24 }, (_, h) => h);
const WEEKDAY = new Intl.DateTimeFormat("fr-FR", { weekday: "short" });

export interface GridProps {
  days: number[];
  events: CalEventRow[];
  calendars: CalCalendarRow[];
  overlays: AgendaOverlay[];
  /** Références des tâches ouvertes ; `null` tant qu'elles chargent (rien n'est barré). */
  openTaskRefs: ReadonlySet<string> | null;
  /** Glisser pour créer, déplacer, redimensionner : ordinateur seulement. */
  interactive: boolean;
  onSelectEvent: (ev: CalEventRow, anchor: HTMLElement) => void;
  onCreateAt: (startAt: number, endAt: number, allDay: boolean) => void;
  onMoveEvent: (ev: CalEventRow, startAt: number, endAt: number) => void;
  /** Dépôt d'une tâche du tiroir (glisser HTML5), ordinateur seulement. */
  onDropTask?: (ref: string, startAt: number) => void;
  /** Rendu téléphone à la Google Agenda : heures hautes, pastilles pleines, marge étroite. */
  mobile?: boolean;
  /** Tap sur l'en-tête d'un jour (vues multi-jours) : ouvre ce jour. */
  onPickDay?: (day: number) => void;
}

type Drag =
  | { kind: "move" | "resize"; ev: CalEventRow; el: HTMLElement; x0: number; y0: number; day0: number; startAt: number; endAt: number; moved: boolean }
  | { kind: "create"; day: number; fromMin: number; toMin: number };

const snap = (min: number) => Math.round(min / SNAP_MIN) * SNAP_MIN;
const clampMin = (min: number) => Math.min(24 * 60, Math.max(0, min));

function overlapsDay(ev: CalEventRow, day: number): boolean {
  return ev.startAt < day + DAY_MS && ev.endAt > day;
}

export function TimeGrid({
  days,
  events,
  calendars,
  overlays,
  openTaskRefs,
  interactive,
  onSelectEvent,
  onCreateAt,
  onMoveEvent,
  onDropTask,
  mobile = false,
  onPickDay,
}: GridProps) {
  const PX_PER_MIN = mobile ? MOBILE_PX_PER_MIN : DESKTOP_PX_PER_MIN;
  const scrollRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const columnsRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [dropAt, setDropAt] = useState<{ day: number; min: number } | null>(null);

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
  const dropSlot = (e: ReactDragEvent<HTMLElement>) => ({
    day: pointerDay(e.clientX),
    min: Math.min(snap(pointerMinute(e.clientY)), 24 * 60 - SLOT_MIN),
  });

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

  const cols = `${mobile ? "2.5rem" : "3rem"} repeat(${days.length}, minmax(0, 1fr))`;
  const single = days.length === 1;
  const hasAllDayRow = days.some(
    (day) => allDay.some((ev) => overlapsDay(ev, day)) || overlays.some((o) => o.date === dateKey(day) && o.atMs === null),
  );
  const solidText = (calendarId: string) => (mobile ? calendarTextColor(calendars, calendarId) : undefined);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* En-têtes de jours */}
      <div className="grid shrink-0 border-b" style={{ gridTemplateColumns: cols, borderColor: "var(--border-subtle)" }}>
        <div />
        {days.map((day) => {
          const today = isSameDay(day, now);
          const label = (
            <>
              <span
                className={`capitalize ${mobile ? "text-[11px] font-medium uppercase" : "text-[11px]"}`}
                style={{ color: today ? "var(--accent)" : "var(--text-muted)" }}
              >
                {WEEKDAY.format(day)}
              </span>
              <span
                className={`flex items-center justify-center rounded-full px-1 tabular-nums ${mobile ? "h-8 min-w-8 text-lg" : "h-7 min-w-7 text-sm font-semibold"}`}
                style={today ? { background: "var(--accent)", color: "var(--accent-foreground)" } : { color: "var(--text-primary)" }}
              >
                {new Date(day).getDate()}
              </span>
            </>
          );
          // Bouton natif : cellule d'en-tête dense, empilement vertical que le Button HeroUI centrerait en ligne.
          return onPickDay && !single ? (
            <button
              key={day}
              type="button"
              onClick={() => onPickDay(day)}
              aria-label={`Voir le ${new Date(day).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" })}`}
              className="flex flex-col items-center rounded-md py-1.5 outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)]"
            >
              {label}
            </button>
          ) : (
            <div key={day} className={`flex flex-col py-1.5 ${single && mobile ? "items-start pl-2" : "items-center"}`}>
              {label}
            </div>
          );
        })}
      </div>

      {/* Bande « toute la journée » : événements sur la journée, todos, dates de bases.
          Au téléphone, masquée quand elle est vide : la hauteur compte. */}
      {(!mobile || hasAllDayRow) && (
        <div className="grid shrink-0 border-b" style={{ gridTemplateColumns: cols, borderColor: "var(--border-subtle)" }}>
          <div className="flex items-start justify-end px-1 pt-1 text-[10px]" style={{ color: "var(--text-muted)" }}>
            {mobile ? "" : "Journée"}
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
                    solidText={solidText(ev.calendarId)}
                    taskClosed={isTaskClosed(ev, openTaskRefs)}
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
      )}

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
                {h === 0 ? "" : mobile ? `${h} h` : `${String(h).padStart(2, "0")}:00`}
              </span>
            ))}
          </div>
          <div
            ref={columnsRef}
            className="relative grid"
            style={{ gridColumn: `2 / span ${days.length}`, gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))` }}
            onDragOver={(e) => {
              if (!onDropTask || !e.dataTransfer.types.includes(TASK_DRAG_MIME)) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = "copy";
              const next = dropSlot(e);
              setDropAt((prev) => (prev?.day === next.day && prev.min === next.min ? prev : next));
            }}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropAt(null);
            }}
            onDrop={(e) => {
              const ref = e.dataTransfer.getData(TASK_DRAG_MIME);
              setDropAt(null);
              if (!onDropTask || !ref) return;
              e.preventDefault();
              const slot = dropSlot(e);
              onDropTask(ref, (days[slot.day] ?? firstDay) + slot.min * 60_000);
            }}
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
                          solidText={solidText(p.item.calendarId)}
                          style={{ height: "100%" }}
                          taskClosed={isTaskClosed(p.item, openTaskRefs)}
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
                  {dropAt?.day === dayIndex && (
                    <div
                      className="pointer-events-none absolute inset-x-0.5 rounded-md"
                      style={{
                        ...eventTint("var(--accent)", true),
                        top: dropAt.min * PX_PER_MIN,
                        height: SLOT_MIN * PX_PER_MIN,
                      }}
                    />
                  )}
                  {showNow && (
                    <div
                      aria-hidden
                      className="pointer-events-none absolute inset-x-0 z-20 h-0.5"
                      style={{ top: minutesOfDay(now) * PX_PER_MIN, background: "var(--danger)" }}
                    >
                      <span className="absolute -left-1.5 -top-[5px] h-3 w-3 rounded-full" style={{ background: "var(--danger)" }} />
                    </div>
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

