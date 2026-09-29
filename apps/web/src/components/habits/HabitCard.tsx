"use client";

/**
 * HabitCard — une habitude = une carte allégée : tuile emoji teintée, nom,
 * série, objectif + rappel, menu ⋯, puis une bande d'une rangée (une cellule
 * par période récente). La grille annuelle et les stats sont repliées sous
 * « Historique ». Cocher se fait dans la vue « aujourd'hui » (HabitsToday).
 */

import { memo, useMemo, useState } from "react";
import { Button } from "@heroui/react";
import { DropdownMenu, Tooltip } from "@supernote/ui";
import {
  Archive,
  Bell,
  CaretDown,
  CaretRight,
  DotsThree,
  Fire,
  PencilSimple,
  Trash,
} from "@phosphor-icons/react";
import {
  STRIP_LENGTH,
  goalLabel,
  habitStats,
  habitStreaks,
  periodStrip,
  remindLabel,
  toDateKey,
  type Habit,
  type HabitPeriod,
} from "@/lib/habits/habitData";
import { PixelGrid, cellBackground } from "./PixelGrid";

interface HabitCardProps {
  habit: Habit;
  /** Pixel à animer (jour fraîchement coché sur CETTE habitude). */
  poppingKey: string | null;
  onCycleDay: (habit: Habit, dateKey: string) => void;
  onEdit: (habit: Habit) => void;
  onArchiveToggle: (habit: Habit) => void;
  onDelete: (habit: Habit) => void;
}

const PERIOD_NOUN: Record<HabitPeriod, { noun: string; validated: string }> = {
  day: { noun: "jour", validated: "validé" },
  week: { noun: "semaine", validated: "validée" },
  month: { noun: "mois", validated: "validé" },
};

const plural = (n: number, word: string): string => (n > 1 && word !== "mois" ? `${word}s` : word);

function HabitHistory({
  habit,
  poppingKey,
  onCycleDay,
}: {
  habit: Habit;
  poppingKey: string | null;
  onCycleDay: (key: string) => void;
}) {
  const stats = habitStats(habit, new Date());
  const { best } = habitStreaks(habit, new Date());
  const { noun, validated } = PERIOD_NOUN[habit.period];
  return (
    <div className="mt-2 flex flex-col gap-2">
      <PixelGrid habit={habit} poppingKey={poppingKey} onCycleDay={onCycleDay} />
      <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>
        record {best} · {stats.total} {plural(stats.total, noun)} {plural(stats.total, validated)} ·{" "}
        {stats.rate} % sur {stats.windowLabel}
      </p>
    </div>
  );
}

export const HabitCard = memo(function HabitCard({
  habit,
  poppingKey,
  onCycleDay,
  onEdit,
  onArchiveToggle,
  onDelete,
}: HabitCardProps) {
  const [historyOpen, setHistoryOpen] = useState(false);
  const todayKey = toDateKey(new Date());

  const { streak, strip } = useMemo(() => {
    const today = new Date();
    return {
      streak: habitStreaks(habit, today).current,
      strip: periodStrip(habit, today, STRIP_LENGTH[habit.period]),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [habit, todayKey]);

  const remind = remindLabel(habit);
  const { noun } = PERIOD_NOUN[habit.period];

  return (
    <section
      id={`habit-${habit.id}`}
      className="group rounded-xl border p-4 transition-shadow"
      style={{
        borderColor: "var(--border-subtle)",
        backgroundColor: "var(--surface-1)",
      }}
      aria-label={habit.name}
    >
      <header className="mb-3 flex items-center gap-3">
        <span
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-lg"
          style={{ backgroundColor: `color-mix(in srgb, ${habit.color} 16%, transparent)` }}
          aria-hidden="true"
        >
          {habit.icon}
        </span>

        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
            {habit.name}
          </h2>
          <p
            className="flex items-center gap-1 truncate text-[11px]"
            style={{ color: "var(--text-muted)" }}
          >
            <span className="truncate">{goalLabel(habit)}</span>
            {remind && (
              <>
                <span aria-hidden="true">·</span>
                <Bell size={11} aria-hidden="true" className="shrink-0" />
                <span className="truncate">{remind}</span>
              </>
            )}
          </p>
        </div>

        <span
          className="flex shrink-0 items-center gap-1 text-xs"
          title={`Série en cours : ${streak} ${plural(streak, noun)}`}
          style={{
            color: streak > 0 ? habit.color : "var(--text-disabled)",
            fontWeight: 600,
          }}
        >
          <Fire
            size={14}
            weight={streak > 0 ? "fill" : "regular"}
            className={streak >= 7 ? "sn-streak-flame" : undefined}
          />
          {streak}
        </span>

        <DropdownMenu
          className="w-48"
          trigger={
            <Tooltip content="Actions">
              <Button
                variant="ghost"
                size="sm"
                isIconOnly
                aria-label={`Actions pour ${habit.name}`}
                className="h-9 w-9 shrink-0 md:h-8 md:w-8"
                style={{ color: "var(--text-muted)" }}
              >
                <DotsThree size={20} weight="bold" aria-hidden />
              </Button>
            </Tooltip>
          }
          items={[
            {
              key: "edit",
              label: "Modifier",
              startContent: <PencilSimple size={14} />,
              onPress: () => onEdit(habit),
            },
            {
              key: "archive",
              label: habit.archived ? "Désarchiver" : "Archiver",
              startContent: <Archive size={14} />,
              onPress: () => onArchiveToggle(habit),
            },
            {
              key: "delete",
              label: "Supprimer",
              startContent: <Trash size={14} />,
              isDanger: true,
              onPress: () => onDelete(habit),
            },
          ]}
        />
      </header>

      <div
        className="grid gap-[3px]"
        style={{ gridTemplateColumns: `repeat(${strip.length}, minmax(0, 1fr))` }}
        role="img"
        aria-label={`Historique récent de ${habit.name}`}
      >
        {strip.map((cell, i) => (
          <span
            key={cell.key}
            title={cell.label}
            className="h-3 rounded-[3px]"
            style={{
              backgroundColor: cellBackground(cell.level, habit.color),
              outline:
                i === strip.length - 1
                  ? `1.5px solid color-mix(in srgb, ${habit.color} 75%, var(--text-muted))`
                  : undefined,
              outlineOffset: 1,
            }}
          />
        ))}
      </div>

      <Button
        variant="ghost"
        size="sm"
        onPress={() => setHistoryOpen((v) => !v)}
        aria-expanded={historyOpen}
        className="mt-2 h-8 min-w-0 gap-1 rounded px-2 text-xs md:h-7"
        style={{ color: "var(--text-muted)" }}
      >
        {historyOpen ? <CaretDown size={12} aria-hidden /> : <CaretRight size={12} aria-hidden />}
        Historique
      </Button>
      {historyOpen && (
        <HabitHistory
          habit={habit}
          poppingKey={poppingKey}
          onCycleDay={(key) => onCycleDay(habit, key)}
        />
      )}
    </section>
  );
});
