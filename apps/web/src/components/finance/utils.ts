import type { Account, Asset, Loan, Snapshot } from "./fixtures";
import { computeMonthlyPayment, computeRemainingPrincipal } from "@supernote/finance/amortization";

/**
 * Parse a user-typed decimal string supporting both English (`1234.56`) and
 * French (`1234,56`) notation. Stripped of spaces and thousands separators.
 * Returns `0` for empty / unparseable input — finance forms persist `0`
 * rather than `NaN` so the field never lands in a weird state.
 *
 * Why this exists: HTML5 `type="number"` rejects comma as decimal under all
 * locales, so an FR user typing `1234,56` saw the input clear out and the
 * blur persisted `0`. We therefore use `type="text" inputMode="decimal"`
 * across finance forms and route every value through this parser.
 */
export function parseDecimal(s: string): number {
  if (!s) return 0;
  const cleaned = s.replace(/\s+/g, "").replace(/,/g, ".");
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : 0;
}

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

// Derived totals — accept live data

export function computeTotalCash(accounts: Account[]): number {
  return accounts.reduce((s, a) => s + a.balance, 0);
}

export function computeTotalAssets(assets: Asset[]): number {
  return assets.reduce((s, a) => s + a.currentValue, 0);
}

export function computeTotalLoansRemaining(loans: Loan[], asOf = new Date()): number {
  return loans.reduce((s, loan) => {
    const remaining = computeRemainingPrincipal(
      {
        principal: loan.principal,
        annualRate: loan.annualRate,
        termMonths: loan.termMonths,
        startDate: new Date(loan.startDate),
      },
      asOf
    );
    return s + remaining;
  }, 0);
}

export function computeCurrentNetWorth(accounts: Account[], assets: Asset[], loans: Loan[], asOf = new Date()): number {
  return computeTotalCash(accounts) + computeTotalAssets(assets) - computeTotalLoansRemaining(loans, asOf);
}

export function getNetWorthVariation(snapshots: Snapshot[]): { absolute: number; percent: number } {
  const latest = snapshots[snapshots.length - 1];
  const prev = snapshots[snapshots.length - 2];
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

export function getLoanMonthlyPayment(loan: Loan): number {
  return computeMonthlyPayment({
    principal: loan.principal,
    annualRate: loan.annualRate,
    termMonths: loan.termMonths,
    startDate: new Date(loan.startDate),
  });
}

export function getLoanRemainingPrincipal(loan: Loan, asOf = new Date()): number {
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

export function getLoanEndDate(loan: Loan): Date {
  const d = new Date(loan.startDate);
  d.setMonth(d.getMonth() + loan.termMonths);
  return d;
}

export function getGoalETA(targetDate: string): string {
  const now = new Date();
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
