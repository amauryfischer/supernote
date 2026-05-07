"use client";

import Link from "next/link";
import { ArrowRight } from "@phosphor-icons/react";
import { ACCOUNTS, ASSETS, GOALS } from "./fixtures";
import { formatCurrency, CATEGORY_LABELS, CATEGORY_COLORS, getGoalETA } from "./utils";

const KIND_LABELS: Record<string, string> = {
  checking: "Courant",
  savings: "Épargne",
  livret: "Livret",
  pea: "PEA",
  cto: "CTO",
  assurance_vie: "AV",
  crypto: "Crypto",
  other: "Autre",
};

export function AccountsList() {
  const top5 = ACCOUNTS.slice(0, 5);
  return (
    <div
      className="rounded-xl border p-4"
      style={{ backgroundColor: "var(--surface-1)", borderColor: "var(--border-subtle)" }}
    >
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
          Comptes
        </h3>
        <Link
          href="/finance/comptes"
          className="flex items-center gap-1 text-xs"
          style={{ color: "var(--accent)" }}
        >
          Voir tout <ArrowRight size={12} />
        </Link>
      </div>
      <div className="flex flex-col gap-2">
        {top5.map((acc) => (
          <div key={acc.id} className="flex items-center justify-between">
            <div>
              <p className="text-xs font-medium" style={{ color: "var(--text-primary)" }}>
                {acc.name}
              </p>
              <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                {KIND_LABELS[acc.kind] ?? acc.kind} · {acc.institution}
              </p>
            </div>
            <span className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
              {formatCurrency(acc.balance)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

const assetsByCategory = ASSETS.reduce<Record<string, typeof ASSETS>>((acc, asset) => {
  const cat = asset.category;
  if (!acc[cat]) acc[cat] = [];
  acc[cat]!.push(asset);
  return acc;
}, {});

export function AssetsList() {
  return (
    <div
      className="rounded-xl border p-4"
      style={{ backgroundColor: "var(--surface-1)", borderColor: "var(--border-subtle)" }}
    >
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
          Actifs
        </h3>
        <Link
          href="/finance/actifs"
          className="flex items-center gap-1 text-xs"
          style={{ color: "var(--accent)" }}
        >
          Voir tout <ArrowRight size={12} />
        </Link>
      </div>
      <div className="flex flex-col gap-2">
        {Object.entries(assetsByCategory).map(([cat, assets]) => {
          const total = assets.reduce((s, a) => s + a.currentValue, 0);
          return (
            <div key={cat} className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: CATEGORY_COLORS[cat] ?? "#94A3B8" }}
                />
                <div>
                  <p className="text-xs font-medium" style={{ color: "var(--text-primary)" }}>
                    {CATEGORY_LABELS[cat] ?? cat}
                  </p>
                  <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                    {assets.length} actif{assets.length > 1 ? "s" : ""}
                  </p>
                </div>
              </div>
              <span className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                {formatCurrency(total)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const GOAL_CATEGORY_COLORS: Record<string, string> = {
  savings: "#16A34A",
  investment: "#2563EB",
  debt: "#EF4444",
  patrimony: "#7C3AED",
};

export function GoalsList() {
  const top3 = GOALS.slice(0, 3);
  return (
    <div
      className="rounded-xl border p-4"
      style={{ backgroundColor: "var(--surface-1)", borderColor: "var(--border-subtle)" }}
    >
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
          Objectifs
        </h3>
        <Link
          href="/finance/objectifs"
          className="flex items-center gap-1 text-xs"
          style={{ color: "var(--accent)" }}
        >
          Voir tout <ArrowRight size={12} />
        </Link>
      </div>
      <div className="flex flex-col gap-3">
        {top3.map((goal) => {
          const pct = Math.min((goal.currentAmount / goal.targetAmount) * 100, 100);
          const color = GOAL_CATEGORY_COLORS[goal.category] ?? "var(--accent)";
          return (
            <div key={goal.id}>
              <div className="mb-1 flex items-center justify-between">
                <p className="text-xs font-medium" style={{ color: "var(--text-primary)" }}>
                  {goal.name}
                </p>
                <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                  {getGoalETA(goal.targetDate)}
                </span>
              </div>
              <div
                className="h-1.5 w-full overflow-hidden rounded-full"
                style={{ backgroundColor: "var(--surface-3)" }}
              >
                <div
                  className="h-full rounded-full transition-all"
                  style={{ width: `${pct}%`, backgroundColor: color }}
                />
              </div>
              <p className="mt-0.5 text-xs" style={{ color: "var(--text-muted)" }}>
                {formatCurrency(goal.currentAmount)} / {formatCurrency(goal.targetAmount)} ({pct.toFixed(0)} %)
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
