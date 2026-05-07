"use client";

import { useCallback } from "react";
import { Camera, ArrowsClockwise, Wallet } from "@phosphor-icons/react";
import { AppShell } from "@/components/shell";
import { EmptyState, SkeletonCard } from "@supernote/ui";
import { MetricCard } from "@/components/finance/MetricCard";
import { NetWorthChart } from "@/components/finance/NetWorthChart";
import { CategoryDonut } from "@/components/finance/CategoryDonut";
import { AccountsList, AssetsList, GoalsList } from "@/components/finance/QuickLists";
import { LoanTimeline } from "@/components/finance/LoanTimeline";
import {
  computeCurrentNetWorth,
  computeTotalCash,
  computeTotalAssets,
  computeTotalLoansRemaining,
  getNetWorthVariation,
  formatCurrency,
  formatPercent,
} from "@/components/finance/utils";
import {
  useFinanceAccounts,
  useFinanceAssets,
  useFinanceLoans,
  useFinanceSnapshots,
  useFinanceGoals,
  useIsElectron,
} from "@/components/finance/hooks";
import { trpc } from "@/lib/trpc/client";

export default function FinancePage() {
  const { accounts, isLoading: loadingAccounts } = useFinanceAccounts();
  const { assets, isLoading: loadingAssets } = useFinanceAssets();
  const { loans, isLoading: loadingLoans } = useFinanceLoans();
  const { snapshots, isLoading: loadingSnapshots } = useFinanceSnapshots();
  const { goals, isLoading: loadingGoals } = useFinanceGoals();
  const isElectron = useIsElectron();

  const utils = trpc.useUtils();
  const createSnapshotMutation = trpc.entities.create.useMutation({
    onSuccess: () => {
      void utils.entities.list.invalidate({ typeId: "snapshot" });
    },
  });

  const isLoading = loadingAccounts || loadingAssets || loadingLoans || loadingSnapshots || loadingGoals;

  const today = new Date();
  const totalCash = computeTotalCash(accounts);
  const totalAssets = computeTotalAssets(assets);
  const totalLoansRemaining = computeTotalLoansRemaining(loans, today);
  const currentNetWorth = computeCurrentNetWorth(accounts, assets, loans, today);
  const variation = getNetWorthVariation(snapshots);
  const variationPositive = variation.absolute >= 0;
  const latestSnapshot = snapshots.length > 0 ? snapshots[snapshots.length - 1]! : null;

  const todayLabel = new Intl.DateTimeFormat("fr-FR", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  }).format(today);

  const handleRefreshPrices = useCallback(async () => {
    if (!isElectron) return;
    const tickeredAssets = assets.filter((a) => a.ticker);
    await Promise.allSettled(
      tickeredAssets.map((asset) =>
        trpc.system.fetchPrice
          .query({ ticker: asset.ticker!, isCrypto: false })
          .then(() => utils.entities.list.invalidate({ typeId: "asset" }))
          .catch(() => undefined)
      )
    );
  }, [assets, isElectron, utils]);

  const handleTakeSnapshot = useCallback(async () => {
    if (!isElectron) return;
    const breakdown = assets.reduce<Record<string, number>>((acc, asset) => {
      const key = asset.category === "fund" ? "stock" : asset.category;
      acc[key] = (acc[key] ?? 0) + asset.currentValue;
      return acc;
    }, {});
    breakdown["cash"] = (breakdown["cash"] ?? 0) + totalCash;
    await createSnapshotMutation.mutateAsync({
      typeId: "snapshot",
      fields: {
        taken_at: today.toISOString(),
        total_net_worth: currentNetWorth,
        breakdown: JSON.stringify(breakdown),
      },
    });
  }, [assets, totalCash, currentNetWorth, today, isElectron, createSnapshotMutation]);

  if (isLoading) {
    return (
      <AppShell>
        <div className="flex flex-col gap-6 p-6">
          <div className="grid grid-cols-4 gap-4">
            {Array.from({ length: 4 }, (_, i) => <SkeletonCard key={i} />)}
          </div>
          <SkeletonCard className="h-48" />
          <div className="grid grid-cols-3 gap-4">
            {Array.from({ length: 3 }, (_, i) => <SkeletonCard key={i} />)}
          </div>
        </div>
      </AppShell>
    );
  }

  const hasData = accounts.length > 0 || assets.length > 0;

  if (!hasData && isElectron) {
    return (
      <AppShell>
        <div className="flex h-full items-center justify-center">
          <EmptyState
            icon={<Wallet size={28} />}
            title="Pas encore de données financières"
            description="Importer OFX/CSV ou ajouter un compte pour commencer à suivre votre patrimoine."
            action={{ label: "+ Ajouter un compte", onClick: () => undefined }}
            secondaryAction={{ label: "Importer OFX/CSV", onClick: () => undefined }}
          />
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
    <div className="flex flex-col gap-6 p-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight" style={{ color: "var(--text-primary)" }}>
            Patrimoine
          </h1>
          <p className="mt-0.5 text-sm" style={{ color: "var(--text-muted)" }}>
            Vue d&apos;ensemble au {todayLabel}
            {!isElectron && (
              <span
                className="ml-2 rounded-full px-2 py-0.5 text-xs"
                style={{ backgroundColor: "var(--surface-2)", color: "var(--text-muted)" }}
              >
                mode dégradé — données exemples
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => void handleRefreshPrices()}
            disabled={!isElectron}
            className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-colors hover:bg-[var(--surface-2)] disabled:opacity-50"
            style={{ borderColor: "var(--border)", color: "var(--text-secondary)" }}
          >
            <ArrowsClockwise size={14} />
            Refresh prix
          </button>
          <button
            onClick={() => void handleTakeSnapshot()}
            disabled={!isElectron || createSnapshotMutation.isPending}
            className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors disabled:opacity-50"
            style={{ backgroundColor: "var(--accent)", color: "var(--accent-foreground)" }}
          >
            <Camera size={14} />
            {createSnapshotMutation.isPending ? "Enregistrement..." : "Prendre un snapshot"}
          </button>
        </div>
      </div>

      {/* Row 1 — Metric cards */}
      <div className="grid grid-cols-4 gap-4">
        <MetricCard
          label="Net worth"
          value={formatCurrency(currentNetWorth)}
          delta={{
            value: `${formatPercent(variation.percent)} (${formatCurrency(Math.abs(variation.absolute))}) sur 30j`,
            positive: variationPositive,
          }}
          hero
        />
        <MetricCard
          label="Total liquide"
          value={formatCurrency(totalCash)}
          sub={`${accounts.length} compte${accounts.length > 1 ? "s" : ""}`}
        />
        <MetricCard
          label="Total actifs"
          value={formatCurrency(totalAssets)}
          sub={`${assets.length} actif${assets.length > 1 ? "s" : ""}`}
        />
        <MetricCard
          label="Total dettes"
          value={formatCurrency(totalLoansRemaining)}
          sub={`${loans.length} prêt${loans.length > 1 ? "s" : ""}`}
          delta={{ value: "Capital restant dû", positive: false }}
        />
      </div>

      {/* Row 2 — Evolution chart */}
      <NetWorthChart snapshots={snapshots} />

      {/* Row 3 — Breakdown */}
      <CategoryDonut snapshot={latestSnapshot} />

      {/* Row 4 — Quick lists */}
      <div className="grid grid-cols-3 gap-4">
        <AccountsList accounts={accounts} />
        <AssetsList assets={assets} />
        <GoalsList goals={goals} />
      </div>

      {/* Row 5 — Loan timeline */}
      <LoanTimeline loans={loans} />
    </div>
    </AppShell>
  );
}
