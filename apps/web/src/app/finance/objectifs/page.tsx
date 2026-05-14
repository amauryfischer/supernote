"use client";

import { useCallback, useMemo } from "react";
import { ArrowLeft, Plus, Target } from "@phosphor-icons/react";
import { Button } from "@heroui/react";
import Link from "next/link";
import { AppShell, useMobileTitle, useMobileFab, useMobileHeaderActions } from "@/components/shell";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useFinanceGoals, useFinanceSnapshots } from "@/components/finance/hooks";
import { formatCurrency, formatDate, getGoalETA } from "@/components/finance/utils";
import { projectETA } from "@supernote/finance/snapshots";
import type { SnapshotEntity } from "@supernote/finance/snapshots";
import type { Snapshot } from "@/components/finance/fixtures";
import { trpc } from "@/lib/trpc/client";

const CATEGORY_STYLES: Record<string, { color: string; label: string; bg: string }> = {
  savings: { color: "#16A34A", bg: "#16A34A20", label: "Epargne" },
  investment: { color: "#2563EB", bg: "#2563EB20", label: "Investissement" },
  debt: { color: "#EF4444", bg: "#EF444420", label: "Remboursement dette" },
  patrimony: { color: "#7C3AED", bg: "#7C3AED20", label: "Croissance patrimoine" },
};

function snapshotToEntity(s: Snapshot): SnapshotEntity {
  const takenAt = new Date(s.takenAt);
  return {
    id: s.id,
    typeId: "snapshot",
    filePath: "",
    fields: {
      taken_at: s.takenAt,
      total_net_worth: s.totalNetWorth,
      breakdown: JSON.stringify(s.breakdown),
    },
    body: "",
    tags: [],
    createdAt: takenAt,
    updatedAt: takenAt,
  };
}

export default function ObjectifsPage() {
  const isMobile = useIsMobile();
  const { goals, isLoading, isFallback } = useFinanceGoals();
  const { snapshots } = useFinanceSnapshots();

  const snapshotEntities = snapshots.map(snapshotToEntity);

  const utils = trpc.useUtils();
  const createMutation = trpc.entities.create.useMutation({
    onSuccess: () => {
      void utils.entities.list.invalidate({ typeId: "goal" });
    },
  });
  const handleNewGoal = useCallback(async () => {
    try {
      await createMutation.mutateAsync({
        typeId: "goal",
        fields: {
          name: "Nouvel objectif",
          target_amount: 0,
          current_amount: 0,
          status: "en_cours",
        },
      });
    } catch (err) {
      console.error("[finance/objectifs] create failed", err);
    }
  }, [createMutation]);

  useMobileTitle(isMobile ? "Objectifs" : null);
  useMobileFab(
    isMobile
      ? { icon: Plus, label: "Nouvel objectif", onPress: () => void handleNewGoal() }
      : null
  );
  useMobileHeaderActions([]);

  return (
    <AppShell>
    <div className="flex flex-col gap-6 px-3 py-6 md:px-6">
      <div className="hidden md:flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/finance" className="flex items-center gap-1 text-sm" style={{ color: "var(--text-muted)" }}>
            <ArrowLeft size={14} /> Finance
          </Link>
          <span style={{ color: "var(--border)" }}>/</span>
          <h1 className="text-xl font-bold" style={{ color: "var(--text-primary)" }}>Objectifs</h1>
          {isFallback && (
            <span className="text-xs rounded-full px-2 py-0.5" style={{ backgroundColor: "var(--surface-2)", color: "var(--text-muted)" }}>
              mode dégradé
            </span>
          )}
        </div>
        <Button
          onPress={() => void handleNewGoal()}
          isDisabled={createMutation.isPending}
          size="sm"
          className="flex items-center gap-2 font-medium"
          style={{ backgroundColor: "var(--accent)", color: "var(--accent-foreground)" }}
        >
          <Plus size={14} /> Objectif
        </Button>
      </div>

      {isLoading ? (
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>Chargement...</p>
      ) : goals.length === 0 ? (
        <div
          className="rounded-xl border border-dashed p-8 text-center"
          style={{ borderColor: "var(--border)", backgroundColor: "var(--surface-0)" }}
        >
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>
            Pas encore de données financières. Importer OFX/CSV ou ajouter un objectif.
          </p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {goals.map((goal) => {
              const pct = goal.targetAmount > 0 ? Math.min((goal.currentAmount / goal.targetAmount) * 100, 100) : 0;
              const style = CATEGORY_STYLES[goal.category] ?? { color: "var(--accent)", bg: "var(--accent-subtle)", label: goal.category };
              const etaFromDate = getGoalETA(goal.targetDate);
              const etaFromSnap = projectETA(snapshotEntities, goal.targetAmount);
              const etaLabel = etaFromSnap
                ? new Intl.DateTimeFormat("fr-FR", { month: "short", year: "numeric" }).format(etaFromSnap)
                : etaFromDate;
              const remaining = goal.targetAmount - goal.currentAmount;

              return (
                <Link
                  key={goal.id}
                  href={`/finance/objectifs/${goal.id}`}
                  className="flex flex-col gap-4 rounded-xl border p-5 transition-colors hover:bg-[var(--surface-2)]"
                  style={{ backgroundColor: "var(--surface-1)", borderColor: "var(--border-subtle)" }}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex items-start gap-3">
                      <div
                        className="flex h-9 w-9 items-center justify-center rounded-xl"
                        style={{ backgroundColor: style.bg }}
                      >
                        <Target size={16} style={{ color: style.color }} />
                      </div>
                      <div>
                        <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                          {goal.name}
                        </p>
                        <span
                          className="rounded-full px-2 py-0.5 text-xs font-medium"
                          style={{ backgroundColor: style.bg, color: style.color }}
                        >
                          {style.label}
                        </span>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-xs" style={{ color: "var(--text-muted)" }}>ETA</p>
                      <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>{etaLabel}</p>
                    </div>
                  </div>

                  <div>
                    <div className="mb-2 flex items-center justify-between text-xs">
                      <span style={{ color: "var(--text-secondary)" }}>{formatCurrency(goal.currentAmount)}</span>
                      <span style={{ color: "var(--text-muted)" }}>{formatCurrency(goal.targetAmount)}</span>
                    </div>
                    <div
                      className="h-3 w-full overflow-hidden rounded-full"
                      style={{ backgroundColor: "var(--surface-3)" }}
                    >
                      <div
                        className="h-full rounded-full transition-all"
                        style={{ width: `${pct}%`, backgroundColor: style.color }}
                      />
                    </div>
                    <div className="mt-1 flex items-center justify-between text-xs">
                      <span style={{ color: style.color }} className="font-semibold">{pct.toFixed(1).replace(".", ",")} %</span>
                      <span style={{ color: "var(--text-muted)" }}>Reste {formatCurrency(remaining)}</span>
                    </div>
                  </div>

                  <div className="border-t pt-3" style={{ borderColor: "var(--border-subtle)" }}>
                    <div className="flex items-center justify-between text-xs">
                      <span style={{ color: "var(--text-muted)" }}>Date cible</span>
                      <span style={{ color: "var(--text-secondary)" }}>{goal.targetDate ? formatDate(goal.targetDate) : "—"}</span>
                    </div>
                    {goal.description && (
                      <p className="mt-1 text-xs italic" style={{ color: "var(--text-muted)" }}>{goal.description}</p>
                    )}
                  </div>
                </Link>
              );
            })}
          </div>

          {/* Summary */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div
              className="rounded-xl border p-4"
              style={{ backgroundColor: "var(--surface-1)", borderColor: "var(--border-subtle)" }}
            >
              <p className="text-xs" style={{ color: "var(--text-muted)" }}>Total objectifs</p>
              <p className="mt-1 text-xl font-bold" style={{ color: "var(--text-primary)" }}>
                {goals.length} objectif{goals.length > 1 ? "s" : ""}
              </p>
            </div>
            <div
              className="rounded-xl border p-4"
              style={{ backgroundColor: "var(--surface-1)", borderColor: "var(--border-subtle)" }}
            >
              <p className="text-xs" style={{ color: "var(--text-muted)" }}>Capital mobilisé</p>
              <p className="mt-1 text-xl font-bold" style={{ color: "var(--text-primary)" }}>
                {formatCurrency(goals.reduce((s, g) => s + g.currentAmount, 0))}
              </p>
            </div>
            <div
              className="rounded-xl border p-4"
              style={{ backgroundColor: "var(--surface-1)", borderColor: "var(--border-subtle)" }}
            >
              <p className="text-xs" style={{ color: "var(--text-muted)" }}>Restant à atteindre</p>
              <p className="mt-1 text-xl font-bold" style={{ color: "var(--text-primary)" }}>
                {formatCurrency(goals.reduce((s, g) => s + (g.targetAmount - g.currentAmount), 0))}
              </p>
            </div>
          </div>
        </>
      )}
    </div>
    </AppShell>
  );
}
