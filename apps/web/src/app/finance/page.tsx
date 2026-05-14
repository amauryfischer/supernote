"use client";

import { useCallback, useMemo } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { Camera, ArrowsClockwise, Wallet } from "@phosphor-icons/react";
import { Button } from "@heroui/react";
import { AppShell, useMobileTitle, useMobileFab, useMobileHeaderActions } from "@/components/shell";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useTranslations } from "next-intl";
import { EmptyState, SkeletonCard } from "@supernote/ui";
import { MetricCard } from "@/components/finance/MetricCard";
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
} from "@/components/finance/hooks";
import { trpc } from "@/lib/trpc/client";

// Dynamic imports: recharts is ~500 kB; defer it until the Finance page mounts.
const NetWorthChart = dynamic(
  () => import("@/components/finance/NetWorthChart").then((m) => m.NetWorthChart),
  { ssr: false, loading: () => <SkeletonCard className="h-[260px]" /> }
);
const CategoryDonut = dynamic(
  () => import("@/components/finance/CategoryDonut").then((m) => m.CategoryDonut),
  { ssr: false, loading: () => <SkeletonCard className="h-[220px]" /> }
);

export default function FinancePage() {
  const t = useTranslations("finance");
  const router = useRouter();
  const isMobile = useIsMobile();
  const { accounts, isLoading: loadingAccounts } = useFinanceAccounts();
  const { assets, isLoading: loadingAssets } = useFinanceAssets();
  const { loans, isLoading: loadingLoans } = useFinanceLoans();
  const { snapshots, isLoading: loadingSnapshots } = useFinanceSnapshots();
  const { goals, isLoading: loadingGoals } = useFinanceGoals();

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

  // Refresh prices and take-snapshot are disabled in PWA mode: live price
  // fetching needs a CORS proxy (out of scope) and snapshot capture should
  // be wired through the worker. Handlers are no-ops until then.
  const handleRefreshPrices = useCallback(async () => {
    /* À venir — proxy CORS requis pour récupérer les cours */
  }, []);

  const handleTakeSnapshot = useCallback(async () => {
    /* À venir — pipeline snapshot via worker */
  }, []);

  useMobileTitle(isMobile ? t("title") : null, isMobile ? todayLabel : null);
  useMobileFab(null);
  useMobileHeaderActions(
    useMemo(
      () =>
        isMobile
          ? [
              {
                id: "snapshot",
                icon: Camera,
                label: t("takeSnapshot"),
                onPress: () => void handleTakeSnapshot(),
              },
            ]
          : [],
      [isMobile, t, handleTakeSnapshot]
    )
  );

  if (isLoading) {
    return (
      <AppShell>
        <div className="flex flex-col gap-6 px-3 py-6 md:px-6">
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            {Array.from({ length: 4 }, (_, i) => <SkeletonCard key={i} />)}
          </div>
          <SkeletonCard className="h-48" />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3">
            {Array.from({ length: 3 }, (_, i) => <SkeletonCard key={i} />)}
          </div>
        </div>
      </AppShell>
    );
  }

  const hasData = accounts.length > 0 || assets.length > 0;

  if (!hasData) {
    return (
      <AppShell>
        <div className="flex h-full items-center justify-center">
          <EmptyState
            icon={<Wallet size={28} />}
            title={t("noData")}
            description={t("noDataHint")}
            action={{ label: t("addAccount"), onClick: () => router.push("/finance/comptes") }}
          />
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
    <div className="flex flex-col gap-6 px-3 py-6 md:px-6">
      {/* Header — desktop only */}
      <div className="hidden md:flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight" style={{ color: "var(--text-primary)" }}>
            {t("title")}
          </h1>
          <p className="mt-0.5 text-sm" style={{ color: "var(--text-muted)" }}>
            {t("overview", { date: todayLabel })}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            onPress={() => void handleRefreshPrices()}
            isDisabled
            aria-label="À venir (proxy CORS)"
            variant="outline"
            size="sm"
            className="flex items-center gap-2 font-medium"
            style={{ borderColor: "var(--border)", color: "var(--text-secondary)" }}
          >
            <ArrowsClockwise size={14} />
            {t("refreshPrices")}
          </Button>
          <Button
            onPress={() => void handleTakeSnapshot()}
            isDisabled
            aria-label="À venir (proxy CORS)"
            size="sm"
            className="flex items-center gap-2 font-medium"
            style={{ backgroundColor: "var(--accent)", color: "var(--accent-foreground)" }}
          >
            <Camera size={14} />
            {createSnapshotMutation.isPending ? t("savingSnapshot") : t("takeSnapshot")}
          </Button>
        </div>
      </div>

      {/* Row 1 — Metric cards */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <MetricCard
          label={t("metrics.netWorth")}
          value={formatCurrency(currentNetWorth)}
          delta={{
            value: `${formatPercent(variation.percent)} (${formatCurrency(Math.abs(variation.absolute))}) sur 30j`,
            positive: variationPositive,
          }}
          hero
        />
        <MetricCard
          label={t("metrics.totalCash")}
          value={formatCurrency(totalCash)}
          sub={`${accounts.length} compte${accounts.length > 1 ? "s" : ""}`}
        />
        <MetricCard
          label={t("metrics.totalAssets")}
          value={formatCurrency(totalAssets)}
          sub={`${assets.length} actif${assets.length > 1 ? "s" : ""}`}
        />
        <MetricCard
          label={t("metrics.totalDebts")}
          value={formatCurrency(totalLoansRemaining)}
          sub={`${loans.length} prêt${loans.length > 1 ? "s" : ""}`}
          delta={{ value: t("metrics.remainingCapital"), positive: false }}
        />
      </div>

      {/* Row 2 — Evolution chart */}
      <NetWorthChart snapshots={snapshots} />

      {/* Row 3 — Breakdown */}
      <CategoryDonut snapshot={latestSnapshot} />

      {/* Row 4 — Quick lists */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3">
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
