"use client";

/**
 * /habits — jardin de pixels (tracker d'habitudes façon HabitPixel).
 *
 * Chaque habitude est une entité `habit` ; ses check-ins quotidiens vivent
 * dans `fields.checkins` (map JSON date → compteur, voir habitData.ts), à
 * tenir `target` fois par période (jour, semaine, mois). La vue « aujourd'hui »
 * (HabitsToday) dit ce qui reste à faire ; les cartes gardent séries, bande
 * récente et grille annuelle repliée.
 *
 * La source de données est résolue par `useHabitsSource` : tRPC (vault
 * worker) quand un vault est monté, localStore en mode dégradé « Aucun
 * vault ». Mutations optimistes : la map locale `pendingCheckins` écrase
 * les check-ins pendant l'aller-retour, le pixel pop est donc instantané.
 * Sons via le bus "supernote:ui-sound" (check à chaque coche, celebrate
 * quand un jalon de série tombe). Tout échec d'écriture remonte en toast —
 * plus jamais d'enregistrement silencieusement perdu.
 *
 * `?habit=<id>` (lien d'une notification de rappel) fait défiler jusqu'à la
 * carte ; avec `&done=1` (bouton « Fait ») il coche le jour, une seule fois.
 */

import { Button } from "@heroui/react";
import {
  AppShell,
  useMobileFab,
  useMobileTitle,
} from "@/components/shell";
import { useIsMobile } from "@/hooks/useIsMobile";
import { Badge, useToast } from "@supernote/ui";
import { GridNine, Plus, Sparkle } from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useConfirm } from "@/lib/confirm";
import {
  habitStreaks,
  isStreakMilestone,
  nextDayCount,
  parseDateKey,
  periodProgress,
  serializeCheckins,
  toDateKey,
  type Habit,
} from "@/lib/habits/habitData";
import { HabitCard } from "@/components/habits/HabitCard";
import { HabitModal, type HabitFormValues } from "@/components/habits/HabitModal";
import { HabitsToday } from "@/components/habits/HabitsToday";
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
  const confirm = useConfirm();
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
  const remaining = habits.filter((h) => !periodProgress(h, new Date()).complete).length;
  const remainingLabel = `${remaining} restante${remaining > 1 ? "s" : ""}`;

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

  // ── Check-in (pixel, ligne « aujourd'hui » ou lien de notification) ──────
  const handleCycleDay = useCallback(
    async (habit: Habit, dateKey: string) => {
      const prev = habit.checkins[dateKey] ?? 0;
      const nextCount = nextDayCount(habit, prev);
      const next = { ...habit.checkins };
      if (nextCount === 0) delete next[dateKey];
      else next[dateKey] = nextCount;

      setPendingCheckins((m) => new Map(m).set(habit.id, next));
      if (nextCount > prev) {
        setPopping(`${habit.id}:${dateKey}`);
        const nextHabit = { ...habit, checkins: next };
        const date = parseDateKey(dateKey);
        const justCompleted =
          !periodProgress(habit, date).complete && periodProgress(nextHabit, date).complete;
        const milestone =
          justCompleted &&
          dateKey === todayKey &&
          isStreakMilestone(habitStreaks(nextHabit, new Date()).current);
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

  // ── Lien `?habit=<id>[&done=1]` ───────────────────────────────────────────
  // Ref : jamais deux applications (re-rendu, HMR) ; l'URL est nettoyée AVANT
  // d'appliquer pour qu'un rechargement ne recoche pas.
  const deepLinkHandled = useRef(false);
  useEffect(() => {
    if (deepLinkHandled.current || source.isLoading) return;
    const params = new URLSearchParams(window.location.search);
    const id = params.get("habit");
    const habit = id ? allHabits.find((h) => h.id === id) : undefined;
    if (!id || !habit) return;
    deepLinkHandled.current = true;
    window.history.replaceState(null, "", "/habits");

    if (params.get("done") === "1") {
      const today = new Date();
      const key = toDateKey(today);
      const count = habit.checkins[key] ?? 0;
      if (!periodProgress(habit, today).complete && nextDayCount(habit, count) > count) {
        void handleCycleDay(habit, key);
      }
      return;
    }
    const card = document.getElementById(`habit-${id}`);
    card?.scrollIntoView({ behavior: "smooth", block: "center" });
    card?.classList.add("sn-habit-highlight");
    window.setTimeout(() => card?.classList.remove("sn-habit-highlight"), 1500);
  }, [allHabits, source.isLoading, handleCycleDay]);

  // ── CRUD habitude ─────────────────────────────────────────────────────────
  const handleCreate = useCallback(
    async (values: HabitFormValues) => {
      setShowCreate(false);
      try {
        await source.createHabit({
          name: values.name,
          icon: values.icon,
          color: values.color,
          period: values.period,
          target: values.target,
          unit: values.unit,
          remindEvery: values.remindEvery,
          remindFrom: values.remindFrom,
          remindTo: values.remindTo,
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
          period: values.period,
          target: values.target,
          unit: values.unit,
          remindEvery: values.remindEvery,
          remindFrom: values.remindFrom,
          remindTo: values.remindTo,
        });
      } catch (err) {
        reportError("Modification non enregistrée", err);
      }
    },
    [editing, source, reportError],
  );

  const handleArchiveToggle = useCallback(
    async ({ id, archived }: Habit) => {
      try {
        await source.updateHabitFields(id, { archived: !archived });
      } catch (err) {
        reportError("Archivage non enregistré", err);
      }
    },
    [source, reportError],
  );

  const handleDelete = useCallback(
    async (habit: Habit) => {
      const ok = await confirm({
        title: `Supprimer « ${habit.name} » ?`,
        body: "L'historique de cette habitude sera perdu.",
        confirmLabel: "Supprimer",
        variant: "danger",
      });
      if (!ok) return;
      try {
        await source.removeHabit(habit.id);
      } catch (err) {
        reportError("Suppression échouée", err);
      }
    },
    [confirm, source, reportError],
  );

  // ── Chrome mobile ─────────────────────────────────────────────────────────
  const isMobile = useIsMobile();
  useMobileTitle(isMobile ? "Habitudes" : null, isMobile && habits.length > 0 ? remainingLabel : null);
  useMobileFab(
    isMobile
      ? { icon: Plus, label: "Nouvelle habitude", onPress: () => setShowCreate(true) }
      : null,
  );

  const renderCard = (h: Habit, popKey: string | null) => (
    <HabitCard
      key={h.id}
      habit={h}
      poppingKey={popKey}
      onCycleDay={(habit, dateKey) => void handleCycleDay(habit, dateKey)}
      onEdit={setEditing}
      onArchiveToggle={(habit) => void handleArchiveToggle(habit)}
      onDelete={(habit) => void handleDelete(habit)}
    />
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
            {habits.length > 0 && <Badge size="md">{remainingLabel}</Badge>}
            {source.mode === "fallback" && (
              <Badge
                variant="warning"
                size="sm"
                title="Aucun vault monté — les habitudes sont stockées dans ce navigateur (localStorage)."
              >
                mode local
              </Badge>
            )}
          </div>
          <Button
            size="sm"
            variant="primary"
            onPress={() => setShowCreate(true)}
            className="flex h-auto min-w-0 items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-opacity hover:opacity-90"
            style={{ backgroundColor: "var(--btn-primary-bg)", color: "var(--btn-primary-fg)" }}
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
            ) : source.isError ? (
              <div className="flex flex-col items-center gap-3 py-20 text-center">
                <p className="text-sm font-medium" style={{ color: "var(--text-secondary)" }}>
                  Impossible de charger les habitudes
                </p>
                <Button size="sm" variant="outline" onPress={source.refetch}>
                  Réessayer
                </Button>
              </div>
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
                  style={{ backgroundColor: "var(--btn-primary-bg)", color: "var(--btn-primary-fg)" }}
                >
                  <Plus size={13} />
                  Créer une habitude
                </Button>
              </div>
            ) : (
              <>
                <HabitsToday habits={habits} onCheck={(h) => void handleCycleDay(h, todayKey)} />
                <h2
                  className="mt-3 px-1 text-[11px] font-semibold uppercase tracking-wide"
                  style={{ color: "var(--text-muted)" }}
                >
                  Toutes les habitudes
                </h2>
                <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                  {habits.map((h) =>
                    renderCard(
                      h,
                      popping?.startsWith(`${h.id}:`) ? popping.slice(h.id.length + 1) : null,
                    ),
                  )}
                </div>
              </>
            )}

            {archivedHabits.length > 0 && (
              <div className="mt-4">
                <Button
                  variant="ghost"
                  size="sm"
                  onPress={() => setShowArchived((v) => !v)}
                  aria-expanded={showArchived}
                  className="h-9 min-w-0 rounded px-2 text-xs md:h-auto md:py-1"
                  style={{ color: "var(--text-muted)" }}
                >
                  {showArchived ? "Masquer" : "Afficher"} les archivées ({archivedHabits.length})
                </Button>
                {showArchived && (
                  <div className="mt-3 grid grid-cols-1 gap-3 opacity-70 lg:grid-cols-2">
                    {archivedHabits.map((h) => renderCard(h, null))}
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
        isMobile={isMobile}
        onSave={(v) => void handleCreate(v)}
        onCancel={() => setShowCreate(false)}
      />
      <HabitModal
        open={editing !== null}
        initial={editing}
        isMobile={isMobile}
        onSave={(v) => void handleUpdate(v)}
        onCancel={() => setEditing(null)}
      />
    </AppShell>
  );
}
