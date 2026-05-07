"use client";

import { Camera, RefreshCw } from "lucide-react";
import { MetricCard } from "@/components/finance/MetricCard";
import { NetWorthChart } from "@/components/finance/NetWorthChart";
import { CategoryDonut } from "@/components/finance/CategoryDonut";
import { AccountsList, AssetsList, GoalsList } from "@/components/finance/QuickLists";
import { LoanTimeline } from "@/components/finance/LoanTimeline";
import {
  currentNetWorth,
  totalCash,
  totalAssets,
  totalLoansRemaining,
  getNetWorthVariation,
  formatCurrency,
  formatPercent,
} from "@/components/finance/utils";
import { ACCOUNTS, ASSETS, LOANS } from "@/components/finance/fixtures";

const TODAY = "07 mai 2026";

export default function FinancePage() {
  const variation = getNetWorthVariation();
  const variationPositive = variation.absolute >= 0;

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight" style={{ color: "var(--text-primary)" }}>
            Patrimoine
          </h1>
          <p className="mt-0.5 text-sm" style={{ color: "var(--text-muted)" }}>
            Vue d&apos;ensemble au {TODAY}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-colors hover:bg-[var(--surface-2)]"
            style={{ borderColor: "var(--border)", color: "var(--text-secondary)" }}
          >
            <RefreshCw size={14} />
            Refresh prix
          </button>
          <button
            className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors"
            style={{
              backgroundColor: "var(--accent)",
              color: "var(--accent-foreground)",
            }}
          >
            <Camera size={14} />
            Prendre un snapshot
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
          sub={`${ACCOUNTS.length} comptes`}
        />
        <MetricCard
          label="Total actifs"
          value={formatCurrency(totalAssets)}
          sub={`${ASSETS.length} actifs`}
        />
        <MetricCard
          label="Total dettes"
          value={formatCurrency(totalLoansRemaining)}
          sub={`${LOANS.length} prêts`}
          delta={{ value: "Capital restant dû", positive: false }}
        />
      </div>

      {/* Row 2 — Evolution chart */}
      <NetWorthChart />

      {/* Row 3 — Breakdown */}
      <CategoryDonut />

      {/* Row 4 — Quick lists */}
      <div className="grid grid-cols-3 gap-4">
        <AccountsList />
        <AssetsList />
        <GoalsList />
      </div>

      {/* Row 5 — Loan timeline */}
      <LoanTimeline />
    </div>
  );
}
