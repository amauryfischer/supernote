"use client";

/**
 * HabitCard — une habitude = une carte : tuile emoji teintée, nom, streaks,
 * bouton check du jour (anneau de progression pour les cibles multiples),
 * puis la grille de pixels annuelle.
 *
 * Le bouton du jour incrémente (0 → 1 → … → cible → 0, même cycle que les
 * pixels) ; l'anneau se remplit en conic-gradient au fil des check-ins.
 */

import { memo, useMemo } from "react";
import { Button } from "@heroui/react";
import { Check, Fire, PencilSimple, Plus, Trophy } from "@phosphor-icons/react";
import {
  computeStats,
  computeStreaks,
  toDateKey,
  type Habit,
} from "@/lib/habits/habitData";
import { PixelGrid } from "./PixelGrid";

interface HabitCardProps {
  habit: Habit;
  /** Pixel à animer (jour fraîchement coché sur CETTE habitude). */
  poppingKey: string | null;
  onCycleDay: (habit: Habit, dateKey: string) => void;
  onEdit: (habit: Habit) => void;
}

export const HabitCard = memo(function HabitCard({
  habit,
  poppingKey,
  onCycleDay,
  onEdit,
}: HabitCardProps) {
  const today = new Date();
  const todayKey = toDateKey(today);
  const todayCount = habit.checkins[todayKey] ?? 0;
  const dayDone = todayCount >= habit.target;

  const { streaks, stats } = useMemo(
    () => ({
      streaks: computeStreaks(habit.checkins, habit.target, today),
      stats: computeStats(habit.checkins, habit.target, today),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [habit.checkins, habit.target, todayKey],
  );

  const goalLabel =
    habit.target > 1
      ? `${habit.target} ${habit.unit || "fois"} / jour`
      : habit.unit
        ? `1 ${habit.unit} / jour`
        : "Chaque jour";

  // Anneau de progression du bouton du jour — rempli à count/target.
  const frac = Math.min(todayCount / habit.target, 1);
  const ringBackground = dayDone
    ? habit.color
    : `conic-gradient(${habit.color} ${frac * 360}deg, var(--surface-3) 0deg)`;

  return (
    <section
      className="group rounded-xl border p-4"
      style={{
        borderColor: "var(--border-subtle)",
        backgroundColor: "var(--surface-1)",
      }}
      aria-label={habit.name}
    >
      <header className="mb-3 flex items-center gap-3">
        {/* Tuile emoji teintée à la couleur de l'habitude */}
        <span
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-lg"
          style={{ backgroundColor: `color-mix(in srgb, ${habit.color} 16%, transparent)` }}
          aria-hidden="true"
        >
          {habit.icon}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <h2
              className="truncate text-sm font-semibold"
              style={{ color: "var(--text-primary)" }}
            >
              {habit.name}
            </h2>
            <Button
              variant="ghost"
              size="sm"
              onPress={() => onEdit(habit)}
              aria-label={`Modifier ${habit.name}`}
              // Seule porte vers l'édition et la suppression d'une habitude,
              // et elle était en survol-seul : au doigt, un bouton invisible
              // de 20×28 collé au titre — inatteignable en pratique, et
              // pourtant capteur de taps.
              className="sn-reveal sn-hit h-auto shrink-0 rounded p-1"
              style={{ color: "var(--text-muted)" }}
            >
              <PencilSimple size={12} />
            </Button>
          </div>
          <p className="truncate text-[11px]" style={{ color: "var(--text-muted)" }}>
            {goalLabel}
          </p>
        </div>

        {/* Streaks — flamme (série en cours) + trophée (record) */}
        <div className="flex shrink-0 items-center gap-3 text-xs">
          <span
            className="flex items-center gap-1"
            title={`Série en cours : ${streaks.current} jour${streaks.current > 1 ? "s" : ""}`}
            style={{
              color: streaks.current > 0 ? habit.color : "var(--text-disabled)",
              fontWeight: 600,
            }}
          >
            <Fire
              size={14}
              weight={streaks.current > 0 ? "fill" : "regular"}
              className={streaks.current >= 7 ? "sn-streak-flame" : undefined}
            />
            {streaks.current}
          </span>
          {streaks.best > 0 && (
            <span
              className="flex items-center gap-1"
              title={`Record : ${streaks.best} jours`}
              style={{ color: "var(--text-muted)" }}
            >
              <Trophy size={13} />
              {streaks.best}
            </span>
          )}
        </div>

        {/* Check du jour — anneau conic + cœur. Validé : plein + ✓. */}
        <Button
          variant="ghost"
          onPress={() => onCycleDay(habit, todayKey)}
          aria-label={
            dayDone
              ? `${habit.name} : journée validée (cliquer pour annuler)`
              : `Cocher ${habit.name} (${todayCount}/${habit.target})`
          }
          className={`h-auto min-w-0 shrink-0 rounded-full p-0 ${dayDone ? "sn-habit-day-done" : ""}`}
        >
          <span
            className="flex h-11 w-11 items-center justify-center rounded-full"
            style={{ background: ringBackground, padding: 3 }}
          >
            <span
              className="flex h-full w-full items-center justify-center rounded-full text-[11px] font-bold"
              style={{
                backgroundColor: dayDone ? habit.color : "var(--surface-1)",
                color: dayDone ? "#fff" : "var(--text-secondary)",
              }}
            >
              {dayDone ? (
                <Check size={18} weight="bold" />
              ) : habit.target > 1 && todayCount > 0 ? (
                `${todayCount}/${habit.target}`
              ) : (
                <Plus size={16} weight="bold" />
              )}
            </span>
          </span>
        </Button>
      </header>

      <PixelGrid
        checkins={habit.checkins}
        target={habit.target}
        color={habit.color}
        createdAt={habit.createdAt}
        poppingKey={poppingKey}
        onCycleDay={(key) => onCycleDay(habit, key)}
      />

      <footer
        className="mt-2 flex items-center gap-3 text-[10px]"
        style={{ color: "var(--text-muted)" }}
      >
        <span>
          {stats.totalDays} jour{stats.totalDays > 1 ? "s" : ""} validé{stats.totalDays > 1 ? "s" : ""}
        </span>
        <span aria-hidden="true">·</span>
        <span>{stats.rate30} % sur 30 j</span>

        {/* Légende d'intensité, façon GitHub */}
        <span className="ml-auto flex items-center gap-1" aria-hidden="true">
          Moins
          {[0, 1, 2, 3].map((lvl) => (
            <span
              key={lvl}
              className="inline-block h-[9px] w-[9px] rounded-[2px]"
              style={{
                backgroundColor:
                  lvl === 0
                    ? "var(--surface-2)"
                    : lvl === 3
                      ? habit.color
                      : `color-mix(in srgb, ${habit.color} ${lvl === 1 ? 32 : 62}%, var(--surface-2))`,
              }}
            />
          ))}
          Plus
        </span>
      </footer>
    </section>
  );
});
