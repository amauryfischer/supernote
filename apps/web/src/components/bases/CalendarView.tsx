"use client";

/**
 * CalendarView — monthly grid with entries placed on their `dateField` value.
 *
 * The "pivot date field" reuses the view's `groupByField` slot — for
 * calendar kinds we interpret that field as the anchor date. Defaults to
 * the first `date`/`datetime` field if not configured.
 *
 * Layout: 7 columns (lundi → dimanche), 5–6 rows of days. Each cell shows
 * the day number + up to 3 entry chips; overflow renders a "+N" badge.
 * Click an entry chip — Phase 1 just toggles a tooltip; Phase 4 will open
 * an entity drawer. Drag-and-drop between cells rewrites the date field.
 */

import { useMemo, useState } from "react";
import { Button } from "@heroui/react";
import { CaretLeft, CaretRight, CalendarBlank } from "@phosphor-icons/react";
import type { EntityType } from "@supernote/core";
import type { View } from "@supernote/ipc";
import { useEntitiesForView, useEntityMutations } from "./hooks";
import { resolveDateField, deriveCardTitle, readDateValue } from "./entity-summary";

interface CalendarViewProps {
  base: EntityType;
  view: View;
}

const DAY_LABELS = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];

const MONTH_LABELS = [
  "Janvier", "Février", "Mars", "Avril", "Mai", "Juin",
  "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre",
];

export function CalendarView({ base, view }: CalendarViewProps) {
  const dateField = resolveDateField(base, view.groupByField);
  const { data } = useEntitiesForView(base.id, view.filters, view.sorts);
  const mut = useEntityMutations(base.id);

  // Cursor month — defaults to today's month. Stored as Date pointing to
  // the 1st of the displayed month so day arithmetic stays simple.
  const [cursor, setCursor] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });

  if (!dateField) {
    return (
      <div
        className="flex h-full items-center justify-center px-4 py-12 text-center text-xs"
        style={{ color: "var(--text-muted)" }}
      >
        Aucun champ <strong>date</strong> sur ce schéma.
        <br />
        Ajoute un champ date pour utiliser la vue Calendrier.
      </div>
    );
  }

  const items = data?.items ?? [];

  // Bucket entries by ISO day string (YYYY-MM-DD).
  const byDay = useMemo(() => {
    const map = new Map<string, typeof items>();
    for (const item of items) {
      const d = readDateValue(item, dateField, item.createdAt, item.updatedAt);
      if (!d) continue;
      const key = isoDay(d);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(item);
    }
    return map;
  }, [items, dateField]);

  const days = buildMonthGrid(cursor);
  const monthLabel = `${MONTH_LABELS[cursor.getMonth()]} ${cursor.getFullYear()}`;
  const today = isoDay(new Date());

  const moveMonth = (delta: -1 | 1) => {
    setCursor((c) => new Date(c.getFullYear(), c.getMonth() + delta, 1));
  };

  const handleDropOnDay = (isoTarget: string, entityId: string) => {
    if (!entityId) return;
    const entity = items.find((e) => e.id === entityId);
    if (!entity) return;
    // Preserve time-of-day when the source had one; otherwise store as midnight.
    const existing = readDateValue(entity, dateField, entity.createdAt, entity.updatedAt);
    const [y, m, d] = isoTarget.split("-").map(Number) as [number, number, number];
    const next = new Date(y, m - 1, d, existing?.getHours() ?? 0, existing?.getMinutes() ?? 0);
    const value = dateField.kind === "datetime" ? next.toISOString() : isoTarget;
    mut.update.mutate({ id: entityId, fields: { [dateField.id]: value as never } });
  };

  return (
    <div className="flex h-full flex-col" style={{ backgroundColor: "var(--surface-0)" }}>
      {/* Toolbar: month nav */}
      <div
        className="flex items-center gap-2 px-3 py-2"
        style={{ borderBottom: "1px solid var(--border-subtle)" }}
      >
        <Button
          variant="ghost"
          size="sm"
          onPress={() => moveMonth(-1)}
          className="rounded p-1 hover:bg-[var(--surface-2)]"
          style={{ color: "var(--text-muted)" }}
          aria-label="Mois précédent"
        >
          <CaretLeft size={12} />
        </Button>
        <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
          {monthLabel}
        </h3>
        <Button
          variant="ghost"
          size="sm"
          onPress={() => moveMonth(1)}
          className="rounded p-1 hover:bg-[var(--surface-2)]"
          style={{ color: "var(--text-muted)" }}
          aria-label="Mois suivant"
        >
          <CaretRight size={12} />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onPress={() => {
            const now = new Date();
            setCursor(new Date(now.getFullYear(), now.getMonth(), 1));
          }}
          className="ml-2 rounded px-2 py-0.5 text-xs font-medium hover:bg-[var(--surface-2)]"
          style={{ color: "var(--text-secondary)" }}
        >
          Aujourd'hui
        </Button>
        <span className="ml-auto text-xs" style={{ color: "var(--text-muted)" }}>
          <CalendarBlank size={11} className="inline" /> {dateField.label || dateField.name}
        </span>
      </div>

      {/* Day headers */}
      <div
        className="grid grid-cols-7 text-center text-[10px] font-semibold uppercase tracking-wide"
        style={{
          backgroundColor: "var(--surface-1)",
          color: "var(--text-muted)",
          borderBottom: "1px solid var(--border-subtle)",
        }}
      >
        {DAY_LABELS.map((l) => (
          <div key={l} className="px-2 py-1.5">
            {l}
          </div>
        ))}
      </div>

      {/* Grid */}
      <div className="grid flex-1 grid-cols-7 overflow-y-auto">
        {days.map((day) => {
          const key = isoDay(day);
          const entries = byDay.get(key) ?? [];
          const inMonth = day.getMonth() === cursor.getMonth();
          const isToday = key === today;
          return (
            <CalendarCell
              key={key}
              day={day}
              dim={!inMonth}
              isToday={isToday}
              entries={entries}
              onDrop={(id) => handleDropOnDay(key, id)}
              renderEntry={(entity) => deriveCardTitle(entity, base)}
            />
          );
        })}
      </div>
    </div>
  );
}

// ── CalendarCell ─────────────────────────────────────────────────────────

interface CalendarCellProps {
  day: Date;
  dim: boolean;
  isToday: boolean;
  entries: Array<{
    id: string;
    filePath: string;
    fields: Record<string, unknown>;
    createdAt: string;
    updatedAt: string;
  }>;
  renderEntry: (entity: {
    id: string;
    filePath: string;
    fields: Record<string, unknown>;
  }) => string;
  onDrop: (entityId: string) => void;
}

const MAX_VISIBLE = 3;

function CalendarCell({ day, dim, isToday, entries, renderEntry, onDrop }: CalendarCellProps) {
  const [over, setOver] = useState(false);
  const visible = entries.slice(0, MAX_VISIBLE);
  const overflow = entries.length - visible.length;

  return (
    <div
      className="flex min-h-[88px] flex-col gap-1 px-1.5 py-1"
      style={{
        borderRight: "1px solid var(--border-subtle)",
        borderBottom: "1px solid var(--border-subtle)",
        backgroundColor: over
          ? "var(--surface-2)"
          : dim
          ? "var(--surface-0)"
          : "var(--surface-1)",
        opacity: dim ? 0.55 : 1,
      }}
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        if (!over) setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const id = e.dataTransfer.getData("text/plain");
        if (id) onDrop(id);
      }}
    >
      <div
        className={`text-[11px] font-semibold ${isToday ? "rounded-full bg-[var(--accent)] px-1.5 text-[var(--accent-foreground)]" : ""}`}
        style={{
          color: isToday
            ? "var(--accent-foreground)"
            : dim
            ? "var(--text-muted)"
            : "var(--text-secondary)",
          alignSelf: "flex-start",
        }}
      >
        {day.getDate()}
      </div>
      <div className="flex flex-col gap-0.5">
        {visible.map((entity) => (
          <div
            key={entity.id}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.effectAllowed = "move";
              e.dataTransfer.setData("text/plain", entity.id);
            }}
            className="cursor-grab truncate rounded px-1.5 py-0.5 text-[11px]"
            style={{
              backgroundColor: "var(--accent)",
              color: "var(--accent-foreground)",
            }}
            title={renderEntry(entity)}
          >
            {renderEntry(entity)}
          </div>
        ))}
        {overflow > 0 && (
          <span
            className="text-[10px]"
            style={{ color: "var(--text-muted)" }}
          >
            +{overflow} de plus
          </span>
        )}
      </div>
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────

function isoDay(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

/**
 * Build a 6×7 grid of Dates covering `cursor`'s month, with leading days
 * from the previous month and trailing days from the next so the grid is
 * always rectangular. Week starts on Monday (French convention).
 */
function buildMonthGrid(cursor: Date): Date[] {
  const firstOfMonth = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  // JS getDay: 0 = Sun .. 6 = Sat. Convert to Mon = 0 .. Sun = 6.
  const dayOfWeek = (firstOfMonth.getDay() + 6) % 7;
  const start = new Date(firstOfMonth);
  start.setDate(start.getDate() - dayOfWeek);
  const cells: Date[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    cells.push(d);
  }
  return cells;
}
