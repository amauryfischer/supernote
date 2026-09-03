"use client";

import { useMemo, useState } from "react";
import { Button } from "@heroui/react";
import { CaretLeft, CaretRight } from "@phosphor-icons/react";

interface JournalCalendarProps {
  selectedDate: string; // "YYYY-MM-DD"
  datesWithNote: Set<string>; // set of "YYYY-MM-DD"
  onSelectDate: (date: string) => void;
}

function toYMD(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function getDaysInMonth(year: number, month: number): Date[] {
  const days: Date[] = [];
  const first = new Date(year, month, 1);
  // Offset so week starts on Monday (0=Mon … 6=Sun)
  const startOffset = (first.getDay() + 6) % 7;
  for (let i = 0; i < startOffset; i++) days.push(new Date(0)); // placeholder
  const last = new Date(year, month + 1, 0).getDate();
  for (let d = 1; d <= last; d++) days.push(new Date(year, month, d));
  return days;
}

const WEEKDAYS = ["L", "M", "M", "J", "V", "S", "D"];

export function JournalCalendar({ selectedDate, datesWithNote, onSelectDate }: JournalCalendarProps) {
  const today = toYMD(new Date());
  const [year, setYear] = useState(() => parseInt(selectedDate.slice(0, 4), 10));
  const [month, setMonth] = useState(() => parseInt(selectedDate.slice(5, 7), 10) - 1);

  const days = useMemo(() => getDaysInMonth(year, month), [year, month]);

  const prevMonth = () => {
    if (month === 0) { setYear((y) => y - 1); setMonth(11); }
    else setMonth((m) => m - 1);
  };

  const nextMonth = () => {
    if (month === 11) { setYear((y) => y + 1); setMonth(0); }
    else setMonth((m) => m + 1);
  };

  const monthLabel = new Date(year, month, 1).toLocaleDateString("fr-FR", {
    month: "long",
    year: "numeric",
  });

  return (
    <div className="select-none px-4 pb-4">
      {/* Month header */}
      <div className="mb-3 flex items-center justify-between">
        <Button
          isIconOnly
          variant="ghost"
          size="sm"
          onPress={prevMonth}
          aria-label="Mois précédent"
          className="h-6 w-6 min-h-0 min-w-0 rounded"
        >
          <CaretLeft size={12} style={{ color: "var(--text-muted)" }} />
        </Button>
        <span className="text-xs font-medium capitalize" style={{ color: "var(--text-secondary)" }}>
          {monthLabel}
        </span>
        <Button
          isIconOnly
          variant="ghost"
          size="sm"
          onPress={nextMonth}
          aria-label="Mois suivant"
          className="h-6 w-6 min-h-0 min-w-0 rounded"
        >
          <CaretRight size={12} style={{ color: "var(--text-muted)" }} />
        </Button>
      </div>

      {/* Weekday headers */}
      <div className="mb-1 grid grid-cols-7 gap-0.5">
        {WEEKDAYS.map((d, i) => (
          <div key={i} className="text-center text-[9px] font-medium" style={{ color: "var(--text-muted)" }}>
            {d}
          </div>
        ))}
      </div>

      {/* Day cells */}
      <div className="grid grid-cols-7 gap-0.5">
        {days.map((day, i) => {
          if (day.getTime() === 0) return <div key={`empty-${i}`} />;
          const ymd = toYMD(day);
          const isSelected = ymd === selectedDate;
          const isToday = ymd === today;
          const hasNote = datesWithNote.has(ymd);

          return (
            <Button
              key={ymd}
              variant="ghost"
              onPress={() => onSelectDate(ymd)}
              aria-label={ymd}
              aria-current={isToday ? "date" : undefined}
              aria-pressed={isSelected}
              className="relative flex flex-col items-center justify-center rounded py-0.5 text-[11px] min-h-0 min-w-0 h-auto w-full"
              style={{
                color: isSelected
                  ? "var(--btn-primary-fg)"
                  : isToday
                  ? "var(--btn-primary-bg)"
                  : "var(--text-secondary)",
                backgroundColor: isSelected ? "var(--accent)" : isToday ? "var(--accent-subtle)" : undefined,
                fontWeight: isToday || isSelected ? 600 : 400,
                minHeight: "1.75rem",
              }}
            >
              {day.getDate()}
              {hasNote && (
                <span
                  className="absolute bottom-0.5 h-1 w-1 rounded-full"
                  style={{ backgroundColor: isSelected ? "var(--btn-primary-fg)" : "var(--btn-primary-bg)" }}
                />
              )}
            </Button>
          );
        })}
      </div>
    </div>
  );
}
