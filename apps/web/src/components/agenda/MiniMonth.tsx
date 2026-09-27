"use client";

import { useRef, useState } from "react";
import { CaretLeft, CaretRight } from "@phosphor-icons/react";
import { Button } from "@supernote/ui";
import { addMonths, isSameDay, viewRange } from "@/lib/agenda/dates";

const WEEKDAY_LETTERS = ["L", "M", "M", "J", "V", "S", "D"];
const MONTH_YEAR = new Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric" });
const DAY_LABEL = new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long" });

interface MiniMonthProps {
  /** Jour affiché par l'agenda, mis en évidence. */
  selected: number;
  onPick: (day: number) => void;
}

/**
 * Sélecteur de date déroulé sous le titre du mois, à la Google Agenda mobile :
 * glisser à gauche/droite ou les flèches changent de mois, un tap choisit le jour.
 */
export function MiniMonth({ selected, onPick }: MiniMonthProps) {
  const [shown, setShown] = useState(() => addMonths(selected, 0));
  const touchX = useRef<number | null>(null);
  const now = Date.now();
  const { days } = viewRange("month", shown);
  const month = new Date(shown).getMonth();

  return (
    <div
      className="w-full pb-2"
      onTouchStart={(e) => {
        touchX.current = e.touches[0]?.clientX ?? null;
      }}
      onTouchEnd={(e) => {
        const x0 = touchX.current;
        const x1 = e.changedTouches[0]?.clientX;
        touchX.current = null;
        if (x0 === null || x1 === undefined || Math.abs(x1 - x0) < 50) return;
        setShown((m) => addMonths(m, x1 < x0 ? 1 : -1));
      }}
    >
      <div className="flex items-center justify-between px-1 pb-1">
        <Button variant="ghost" size="icon" isIconOnly aria-label="Mois précédent" className="h-9 w-9" onPress={() => setShown((m) => addMonths(m, -1))}>
          <CaretLeft size={16} aria-hidden />
        </Button>
        <span className="text-sm font-medium capitalize" style={{ color: "var(--text-primary)" }} aria-live="polite">
          {MONTH_YEAR.format(shown)}
        </span>
        <Button variant="ghost" size="icon" isIconOnly aria-label="Mois suivant" className="h-9 w-9" onPress={() => setShown((m) => addMonths(m, 1))}>
          <CaretRight size={16} aria-hidden />
        </Button>
      </div>
      <div className="grid grid-cols-7 text-center">
        {WEEKDAY_LETTERS.map((w, i) => (
          <span key={i} aria-hidden className="py-1 text-[11px] font-medium" style={{ color: "var(--text-muted)" }}>
            {w}
          </span>
        ))}
        {days.map((day) => {
          const today = isSameDay(day, now);
          const isSelected = isSameDay(day, selected);
          const outside = new Date(day).getMonth() !== month;
          return (
            <div key={day} className="flex justify-center py-0.5">
              <Button
                variant="ghost"
                size="icon"
                isIconOnly
                aria-label={DAY_LABEL.format(day)}
                aria-current={today ? "date" : undefined}
                aria-pressed={isSelected}
                onPress={() => onPick(day)}
                className="h-9 w-9 rounded-full text-sm tabular-nums"
                style={
                  today
                    ? { background: "var(--accent)", color: "var(--accent-foreground)", fontWeight: 600 }
                    : isSelected
                      ? { background: "var(--accent-subtle)", color: "var(--accent)", fontWeight: 600 }
                      : { color: outside ? "var(--text-muted)" : "var(--text-primary)" }
                }
              >
                {new Date(day).getDate()}
              </Button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
