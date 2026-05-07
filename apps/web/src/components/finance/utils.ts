import { ACCOUNTS, ASSETS, LOANS, SNAPSHOTS } from "./fixtures";
import { computeMonthlyPayment, computeRemainingPrincipal } from "@supernote/finance/amortization";

export function formatCurrency(value: number): string {
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export function formatPercent(value: number): string {
  const sign = value >= 0 ? "+" : "";
  return `${sign}${value.toFixed(2).replace(".", ",")} %`;
}

export function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(iso));
}

export function formatShortDate(iso: string): string {
  return new Intl.DateTimeFormat("fr-FR", { month: "short", year: "2-digit" }).format(new Date(iso));
}

// Derived totals from mock data
export const totalCash = ACCOUNTS.reduce((s, a) => s + a.balance, 0);

export const totalAssets = ASSETS.reduce((s, a) => s + a.currentValue, 0);

export const totalLoansRemaining = LOANS.reduce((s, loan) => {
  const remaining = computeRemainingPrincipal(
    {
      principal: loan.principal,
      annualRate: loan.annualRate,
      termMonths: loan.termMonths,
      startDate: new Date(loan.startDate),
    },
    new Date("2026-05-07")
  );
  return s + remaining;
}, 0);

export const currentNetWorth = totalCash + totalAssets - totalLoansRemaining;

export function getNetWorthVariation(): { absolute: number; percent: number } {
  const latest = SNAPSHOTS[SNAPSHOTS.length - 1];
  const prev = SNAPSHOTS[SNAPSHOTS.length - 2];
  if (!latest || !prev) return { absolute: 0, percent: 0 };
  const absolute = latest.totalNetWorth - prev.totalNetWorth;
  const percent = (absolute / prev.totalNetWorth) * 100;
  return { absolute, percent };
}

export const CATEGORY_COLORS: Record<string, string> = {
  cash: "#16A34A",
  stock: "#2563EB",
  crypto: "#D97706",
  real_estate: "#7C3AED",
  bond: "#059669",
  fund: "#0891B2",
  other: "#64748B",
};

export const CATEGORY_LABELS: Record<string, string> = {
  cash: "Cash",
  stock: "Actions",
  crypto: "Crypto",
  real_estate: "Immobilier",
  bond: "Obligations",
  fund: "Fonds",
  other: "Autres",
};

export function getLoanMonthlyPayment(loan: (typeof LOANS)[0]): number {
  return computeMonthlyPayment({
    principal: loan.principal,
    annualRate: loan.annualRate,
    termMonths: loan.termMonths,
    startDate: new Date(loan.startDate),
  });
}

export function getLoanRemainingPrincipal(loan: (typeof LOANS)[0], asOf = new Date("2026-05-07")): number {
  return computeRemainingPrincipal(
    {
      principal: loan.principal,
      annualRate: loan.annualRate,
      termMonths: loan.termMonths,
      startDate: new Date(loan.startDate),
    },
    asOf
  );
}

export function getLoanEndDate(loan: (typeof LOANS)[0]): Date {
  const d = new Date(loan.startDate);
  d.setMonth(d.getMonth() + loan.termMonths);
  return d;
}

export function getGoalETA(targetDate: string): string {
  const now = new Date("2026-05-07");
  const target = new Date(targetDate);
  const months = (target.getFullYear() - now.getFullYear()) * 12 + (target.getMonth() - now.getMonth());
  if (months <= 0) return "Atteint";
  if (months < 12) return `${months} mois`;
  const years = Math.floor(months / 12);
  const rem = months % 12;
  return rem === 0 ? `${years} an${years > 1 ? "s" : ""}` : `${years}a ${rem}m`;
}

export function getBreakdownTotal(breakdown: Record<string, number>): number {
  return Object.values(breakdown).reduce((s, v) => s + v, 0);
}
