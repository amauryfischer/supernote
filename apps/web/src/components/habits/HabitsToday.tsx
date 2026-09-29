"use client";

/**
 * HabitsToday — « qu'est-ce qui reste à faire ? ». Habitudes non archivées
 * groupées par période ; une ligne se touche en entière et déclenche `onCheck`
 * (le parent applique le check-in du jour). Les périodes tenues tombent dans
 * « Fait (n) », replié.
 */

import { useState } from "react";
import { Button } from "@heroui/react";
import { CaretDown, CaretRight, Check } from "@phosphor-icons/react";
import {
  addPeriods,
  periodProgress,
  periodStart,
  progressLabel,
  readableOn,
  type Habit,
  type HabitPeriod,
} from "@/lib/habits/habitData";

interface HabitsTodayProps {
  habits: Habit[];
  onCheck: (habit: Habit) => void;
}

const GROUPS: Array<{ period: HabitPeriod; title: string }> = [
  { period: "day", title: "Aujourd'hui" },
  { period: "week", title: "Cette semaine" },
  { period: "month", title: "Ce mois" },
];

/** Jours restants, aujourd'hui compris, jusqu'à la fin de la période. */
function daysLeft(habit: Habit, today: Date): number {
  const end = addPeriods(habit.period, periodStart(habit.period, today), 1);
  const from = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((end.getTime() - from.getTime()) / 86_400_000);
}

function HabitRow({ habit, today, onCheck }: { habit: Habit; today: Date; onCheck: (h: Habit) => void }) {
  const { done, target, complete } = periodProgress(habit, today);
  const progress = progressLabel(habit, today);
  const left = daysLeft(habit, today);
  const showLeft = habit.period !== "day" && !complete;
  const frac = Math.min(done / target, 1);

  return (
    <Button
      variant="ghost"
      onPress={() => onCheck(habit)}
      aria-label={
        complete
          ? `${habit.name} : ${progress}. Toucher pour modifier le check-in du jour`
          : `Cocher ${habit.name} : ${progress}`
      }
      className="h-auto min-h-12 w-full min-w-0 justify-start gap-3 rounded-lg px-3 py-2 text-left md:min-h-11"
    >
      <span
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
        style={{
          background: complete
            ? habit.color
            : `conic-gradient(${habit.color} ${frac * 360}deg, var(--surface-3) 0deg)`,
          padding: 3,
        }}
        aria-hidden="true"
      >
        <span
          className="flex h-full w-full items-center justify-center rounded-full"
          style={{
            backgroundColor: complete ? habit.color : "var(--surface-1)",
            color: readableOn(habit.color),
          }}
        >
          {complete && <Check size={14} weight="bold" />}
        </span>
      </span>
      <span className="text-lg leading-none" aria-hidden="true">
        {habit.icon}
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-medium" style={{ color: "var(--text-primary)" }}>
          {habit.name}
        </span>
        <span className="truncate text-[11px]" style={{ color: "var(--text-muted)" }}>
          {progress}
          {showLeft && ` · ${left} j restant${left > 1 ? "s" : ""}`}
        </span>
      </span>
    </Button>
  );
}

export function HabitsToday({ habits, onCheck }: HabitsTodayProps) {
  const [doneOpen, setDoneOpen] = useState(false);
  const today = new Date();
  const todo = habits.filter((h) => !periodProgress(h, today).complete);
  const done = habits.filter((h) => periodProgress(h, today).complete);

  return (
    <section
      aria-label="Aujourd'hui"
      className="rounded-xl border p-2"
      style={{ borderColor: "var(--border-subtle)", backgroundColor: "var(--surface-1)" }}
    >
      {GROUPS.map(({ period, title }) => {
        const rows = todo.filter((h) => h.period === period);
        if (rows.length === 0) return null;
        return (
          <div key={period} className="mb-1 last:mb-0">
            <h2
              className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide"
              style={{ color: "var(--text-muted)" }}
            >
              {title}
            </h2>
            {rows.map((h) => (
              <HabitRow key={h.id} habit={h} today={today} onCheck={onCheck} />
            ))}
          </div>
        );
      })}

      {todo.length === 0 && (
        <p className="px-3 py-3 text-sm" style={{ color: "var(--text-secondary)" }}>
          Tout est fait pour aujourd&apos;hui.
        </p>
      )}

      {done.length > 0 && (
        <div>
          <Button
            variant="ghost"
            size="sm"
            onPress={() => setDoneOpen((v) => !v)}
            aria-expanded={doneOpen}
            className="h-9 min-w-0 gap-1 rounded px-3 text-xs md:h-8"
            style={{ color: "var(--text-muted)" }}
          >
            {doneOpen ? <CaretDown size={12} aria-hidden /> : <CaretRight size={12} aria-hidden />}
            Fait ({done.length})
          </Button>
          {doneOpen && done.map((h) => <HabitRow key={h.id} habit={h} today={today} onCheck={onCheck} />)}
        </div>
      )}
    </section>
  );
}
