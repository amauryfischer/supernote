"use client";

/**
 * /habits — jardin de pixels (tracker d'habitudes façon HabitPixel).
 *
 * Chaque habitude est une entité `habit` ; ses check-ins quotidiens vivent
 * dans `fields.checkins` (map JSON date → compteur, voir habitData.ts).
 * Cocher le jour colore un pixel ; les séries (streaks) et la grille
 * annuelle façon GitHub contributions rendent la constance visible.
 *
 * La source de données est résolue par `useHabitsSource` : tRPC (vault
 * worker) quand un vault est monté, localStore en mode dégradé « Aucun
 * vault ». Mutations optimistes : la map locale `pendingCheckins` écrase
 * les check-ins pendant l'aller-retour, le pixel pop est donc instantané.
 * Sons via le bus "supernote:ui-sound" (check à chaque coche, celebrate
 * quand un jalon de série tombe). Tout échec d'écriture remonte en toast —
 * plus jamais d'enregistrement silencieusement perdu.
 */

import { Button } from "@heroui/react";
import {
  AppShell,
  useMobileFab,
  useMobileTitle,
} from "@/components/shell";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useToast } from "@supernote/ui";
import { GridNine, Plus, Sparkle } from "@phosphor-icons/react";
import { useCallback, useMemo, useState } from "react";
import {
  computeStreaks,
  cycleCount,
  isDayComplete,
  isStreakMilestone,
  serializeCheckins,
  toDateKey,
  type Habit,
} from "@/lib/habits/habitData";
import { HabitCard } from "@/components/habits/HabitCard";
import { HabitModal, type HabitFormValues } from "@/components/habits/HabitModal";
import { useHabitsSource } from "@/components/habits/useHabitsSource";
import "@/components/habits/habits.css";

function emitSound(kind: "check" | "celebrate") {
  document.dispatchEvent(new CustomEvent("supernote:ui-sound", { detail: { kind } }));
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export default function HabitsPage() {
  const source = useHabitsSource();
  const { toast } = useToast();
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState<Habit | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  // Override optimiste : habitId → checkins pendant la mutation en vol.
  const [pendingCheckins, setPendingCheckins] = useState<Map<string, Record<string, number>>>(
    () => new Map(),
  );
  // Pixel à animer : `${habitId}:${dateKey}` du dernier check positif.
  const [popping, setPopping] = useState<string | null>(null);

  const allHabits: Habit[] = useMemo(
    () =>
      source.habits.map((h) => {
        const pending = pendingCheckins.get(h.id);
        return pending ? { ...h, checkins: pending } : h;
      }),
    [source.habits, pendingCheckins],
  );

  const habits = useMemo(() => allHabits.filter((h) => !h.archived), [allHabits]);
  const archivedHabits = useMemo(() => allHabits.filter((h) => h.archived), [allHabits]);

  const todayKey = toDateKey(new Date());
  const doneToday = habits.filter((h) => isDayComplete(h.checkins, todayKey, h.target)).length;

  const reportError = useCallback(
    (action: string, err: unknown) => {
      toast({
        title: action,
        description: errorMessage(err),
        variant: "danger",
      });
    },
    [toast],
  );

  // ── Check-in (pixel ou bouton du jour) ────────────────────────────────────
  const handleCycleDay = useCallback(
    async (habit: Habit, dateKey: string) => {
      const prev = habit.checkins[dateKey] ?? 0;
      const nextCount = cycleCount(prev, habit.target);
      const next = { ...habit.checkins };
      if (nextCount === 0) delete next[dateKey];
      else next[dateKey] = nextCount;

      setPendingCheckins((m) => new Map(m).set(habit.id, next));
      if (nextCount > prev) {
        setPopping(`${habit.id}:${dateKey}`);
        const justCompleted = nextCount >= habit.target && prev < habit.target;
        const milestone =
          justCompleted &&
          dateKey === todayKey &&
          isStreakMilestone(computeStreaks(next, habit.target, new Date()).current);
        emitSound(milestone ? "celebrate" : "check");
      }

      try {
        await source.updateHabitFields(habit.id, { checkins: serializeCheckins(next) });
      } catch (err) {
        reportError("Check-in non enregistré", err);
      } finally {
        // Le store porte désormais la vérité (ou l'ancienne valeur si la
        // mutation a échoué) — l'override a fini son travail dans les deux cas.
        setPendingCheckins((m) => {
          const copy = new Map(m);
          copy.delete(habit.id);
          return copy;
        });
      }
    },
    [todayKey, source, reportError],
  );

  // ── CRUD habitude ─────────────────────────────────────────────────────────
  const handleCreate = useCallback(
    async (values: HabitFormValues) => {
      setShowCreate(false);
      try {
        await source.createHabit({
          name: values.name,
          icon: values.icon,
          color: values.color,
          target: values.target,
          unit: values.unit,
          archived: false,
          checkins: "{}",
        });
      } catch (err) {
        reportError("Habitude non créée", err);
      }
    },
    [source, reportError],
  );

  const handleUpdate = useCallback(
    async (values: HabitFormValues) => {
      if (!editing) return;
      const id = editing.id;
      setEditing(null);
      try {
        await source.updateHabitFields(id, {
          name: values.name,
          icon: values.icon,
          color: values.color,
          target: values.target,
          unit: values.unit,
        });
      } catch (err) {
        reportError("Modification non enregistrée", err);
      }
    },
    [editing, source, reportError],
  );

  const handleArchiveToggle = useCallback(async () => {
    if (!editing) return;
    const { id, archived } = editing;
    setEditing(null);
    try {
      await source.updateHabitFields(id, { archived: !archived });
    } catch (err) {
      reportError("Archivage non enregistré", err);
    }
  }, [editing, source, reportError]);

  const handleDelete = useCallback(async () => {
    if (!editing) return;
    const id = editing.id;
    setEditing(null);
    try {
      await source.removeHabit(id);
    } catch (err) {
      reportError("Suppression échouée", err);
    }
  }, [editing, source, reportError]);

  // ── Chrome mobile ─────────────────────────────────────────────────────────
  const isMobile = useIsMobile();
  useMobileTitle(
    isMobile ? "Habitudes" : null,
    isMobile && habits.length > 0 ? `${doneToday}/${habits.length} aujourd'hui` : null,
  );
  useMobileFab(
    isMobile
      ? { icon: Plus, label: "Nouvelle habitude", onPress: () => setShowCreate(true) }
      : null,
  );

  return (
    <AppShell>
      <div className="flex h-full flex-col">
        {/* Header desktop — caché sur mobile (titre + FAB dans le shell). */}
        <div
          className="hidden items-center justify-between border-b px-6 py-3 md:flex"
          style={{ borderColor: "var(--border-subtle)", backgroundColor: "var(--surface-0)" }}
        >
          <div className="flex items-center gap-3">
            <GridNine size={18} style={{ color: "var(--accent)" }} />
            <h1 className="text-lg font-semibold" style={{ color: "var(--text-primary)" }}>
              Habitudes
            </h1>
            {habits.length > 0 && (
              <span
                className="rounded-full px-2 py-0.5 text-xs font-medium"
                style={{ backgroundColor: "var(--surface-3)", color: "var(--text-muted)" }}
              >
                {doneToday} / {habits.length} aujourd&apos;hui
              </span>
            )}
            {source.mode === "fallback" && (
              <span
                className="rounded-full px-2 py-0.5 text-[10px] font-medium"
                style={{
                  backgroundColor: "var(--color-warning-100)",
                  color: "var(--color-warning-700)",
                }}
                title="Aucun vault monté — les habitudes sont stockées dans ce navigateur (localStorage)."
              >
                mode local
              </span>
            )}
          </div>
          <Button
            size="sm"
            variant="primary"
            onPress={() => setShowCreate(true)}
            className="flex h-auto min-w-0 items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-opacity hover:opacity-90"
            style={{ backgroundColor: "var(--accent)", color: "var(--accent-foreground)" }}
          >
            <Plus size={13} />
            Nouvelle habitude
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto flex max-w-5xl flex-col gap-3 p-4 md:p-6">
            {source.isLoading ? (
              <p className="py-12 text-center text-sm" style={{ color: "var(--text-muted)" }}>
                Chargement…
              </p>
            ) : habits.length === 0 ? (
              <div className="flex flex-col items-center gap-3 py-20 text-center">
                <Sparkle size={32} style={{ color: "var(--text-disabled)" }} />
                <p className="text-sm font-medium" style={{ color: "var(--text-secondary)" }}>
                  Aucune habitude pour l&apos;instant.
                </p>
                <p className="max-w-xs text-xs" style={{ color: "var(--text-muted)" }}>
                  Chaque jour tenu devient un pixel. Construis ta première grille.
                </p>
                <Button
                  size="sm"
                  variant="primary"
                  onPress={() => setShowCreate(true)}
                  className="mt-2 flex h-auto min-w-0 items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium"
                  style={{ backgroundColor: "var(--accent)", color: "var(--accent-foreground)" }}
                >
                  <Plus size={13} />
                  Créer une habitude
                </Button>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                {habits.map((h) => (
                  <HabitCard
                    key={h.id}
                    habit={h}
                    poppingKey={
                      popping?.startsWith(`${h.id}:`) ? popping.slice(h.id.length + 1) : null
                    }
                    onCycleDay={(habit, dateKey) => void handleCycleDay(habit, dateKey)}
                    onEdit={setEditing}
                  />
                ))}
              </div>
            )}

            {archivedHabits.length > 0 && (
              <div className="mt-4">
                <Button
                  variant="ghost"
                  size="sm"
                  onPress={() => setShowArchived((v) => !v)}
                  className="h-auto min-w-0 rounded px-2 py-1 text-xs"
                  style={{ color: "var(--text-muted)" }}
                >
                  {showArchived ? "Masquer" : "Afficher"} les archivées ({archivedHabits.length})
                </Button>
                {showArchived && (
                  <div className="mt-3 grid grid-cols-1 gap-3 opacity-70 lg:grid-cols-2">
                    {archivedHabits.map((h) => (
                      <HabitCard
                        key={h.id}
                        habit={h}
                        poppingKey={null}
                        onCycleDay={(habit, dateKey) => void handleCycleDay(habit, dateKey)}
                        onEdit={setEditing}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      <HabitModal
        open={showCreate}
        initial={null}
        onSave={(v) => void handleCreate(v)}
        onCancel={() => setShowCreate(false)}
      />
      <HabitModal
        open={editing !== null}
        initial={editing}
        onSave={(v) => void handleUpdate(v)}
        onCancel={() => setEditing(null)}
        onArchiveToggle={() => void handleArchiveToggle()}
        onDelete={() => void handleDelete()}
      />
    </AppShell>
  );
}
