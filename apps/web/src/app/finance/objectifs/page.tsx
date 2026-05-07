"use client";

import { ArrowLeft, Plus, Target } from "lucide-react";
import Link from "next/link";
import { AppShell } from "@/components/shell";
import { GOALS } from "@/components/finance/fixtures";
import { formatCurrency, formatDate, getGoalETA } from "@/components/finance/utils";

const CATEGORY_STYLES: Record<string, { color: string; label: string; bg: string }> = {
  savings: { color: "#16A34A", bg: "#16A34A20", label: "Épargne" },
  investment: { color: "#2563EB", bg: "#2563EB20", label: "Investissement" },
  debt: { color: "#EF4444", bg: "#EF444420", label: "Remboursement dette" },
  patrimony: { color: "#7C3AED", bg: "#7C3AED20", label: "Croissance patrimoine" },
};

export default function ObjectifsPage() {
  return (
    <AppShell>
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link
            href="/finance"
            className="flex items-center gap-1 text-sm"
            style={{ color: "var(--text-muted)" }}
          >
            <ArrowLeft size={14} /> Finance
          </Link>
          <span style={{ color: "var(--border)" }}>/</span>
          <h1 className="text-xl font-bold" style={{ color: "var(--text-primary)" }}>
            Objectifs
          </h1>
        </div>
        <button
          className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium"
          style={{ backgroundColor: "var(--accent)", color: "var(--accent-foreground)" }}
        >
          <Plus size={14} /> Objectif
        </button>
      </div>

      <div className="grid grid-cols-2 gap-4">
        {GOALS.map((goal) => {
          const pct = Math.min((goal.currentAmount / goal.targetAmount) * 100, 100);
          const style = CATEGORY_STYLES[goal.category] ?? { color: "var(--accent)", bg: "var(--accent-subtle)", label: goal.category };
          const eta = getGoalETA(goal.targetDate);
          const remaining = goal.targetAmount - goal.currentAmount;

          return (
            <div
              key={goal.id}
              className="flex flex-col gap-4 rounded-xl border p-5"
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
                  <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                    {eta}
                  </p>
                </div>
              </div>

              <div>
                <div className="mb-2 flex items-center justify-between text-xs">
                  <span style={{ color: "var(--text-secondary)" }}>
                    {formatCurrency(goal.currentAmount)}
                  </span>
                  <span style={{ color: "var(--text-muted)" }}>
                    {formatCurrency(goal.targetAmount)}
                  </span>
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
                  <span style={{ color: style.color }} className="font-semibold">
                    {pct.toFixed(1).replace(".", ",")} %
                  </span>
                  <span style={{ color: "var(--text-muted)" }}>
                    Reste {formatCurrency(remaining)}
                  </span>
                </div>
              </div>

              <div className="border-t pt-3" style={{ borderColor: "var(--border-subtle)" }}>
                <div className="flex items-center justify-between text-xs">
                  <span style={{ color: "var(--text-muted)" }}>Date cible</span>
                  <span style={{ color: "var(--text-secondary)" }}>{formatDate(goal.targetDate)}</span>
                </div>
                {goal.description && (
                  <p className="mt-1 text-xs italic" style={{ color: "var(--text-muted)" }}>
                    {goal.description}
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Summary */}
      <div className="grid grid-cols-3 gap-4">
        <div
          className="rounded-xl border p-4"
          style={{ backgroundColor: "var(--surface-1)", borderColor: "var(--border-subtle)" }}
        >
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>Total objectifs</p>
          <p className="mt-1 text-xl font-bold" style={{ color: "var(--text-primary)" }}>
            {GOALS.length} objectifs
          </p>
        </div>
        <div
          className="rounded-xl border p-4"
          style={{ backgroundColor: "var(--surface-1)", borderColor: "var(--border-subtle)" }}
        >
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>Capital mobilisé</p>
          <p className="mt-1 text-xl font-bold" style={{ color: "var(--text-primary)" }}>
            {formatCurrency(GOALS.reduce((s, g) => s + g.currentAmount, 0))}
          </p>
        </div>
        <div
          className="rounded-xl border p-4"
          style={{ backgroundColor: "var(--surface-1)", borderColor: "var(--border-subtle)" }}
        >
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>Restant à atteindre</p>
          <p className="mt-1 text-xl font-bold" style={{ color: "var(--text-primary)" }}>
            {formatCurrency(GOALS.reduce((s, g) => s + (g.targetAmount - g.currentAmount), 0))}
          </p>
        </div>
      </div>
    </div>
    </AppShell>
  );
}
