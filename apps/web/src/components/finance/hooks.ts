"use client";

/**
 * Finance tRPC hooks — bridge between live IPC data and the finance pages.
 * Falls back to fixture data when window.__supernoteIPC is not available.
 *
 * Entity field conventions (as stored by desktop impl):
 *   Account  : name, kind, institution, current_balance, currency, last_synced_at, iban
 *   Asset    : name, category, acquisition_date, acquisition_value, current_value,
 *              account_id, ticker, symbol
 *   Loan     : name, kind, lender, principal, annual_rate, term_months, start_date
 *   Snapshot : taken_at, total_net_worth, breakdown (JSON string), notes
 *   Goal     : name, category, target_amount, current_progress, target_date, description
 */

import { trpc } from "@/lib/trpc/client";
import {
  ACCOUNTS,
  ASSETS,
  LOANS,
  SNAPSHOTS,
  GOALS,
  type Account,
  type Asset,
  type Loan,
  type Snapshot,
  type Goal,
} from "./fixtures";
import type { EntitySummary } from "@supernote/ipc";

// ---------------------------------------------------------------------------
// Electron detection
// ---------------------------------------------------------------------------

export function useIsElectron(): boolean {
  if (typeof window === "undefined") return false;
  return !!window.__supernoteIPC;
}

// ---------------------------------------------------------------------------
// Entity → domain type adapters
// ---------------------------------------------------------------------------

function strField(fields: Record<string, unknown>, key: string): string {
  const v = fields[key];
  return typeof v === "string" ? v : "";
}

function numField(fields: Record<string, unknown>, key: string): number {
  const v = fields[key];
  if (typeof v === "number") return v;
  if (typeof v === "string") { const n = parseFloat(v); return isNaN(n) ? 0 : n; }
  return 0;
}

export function entityToAccount(e: EntitySummary): Account {
  const f = e.fields as Record<string, unknown>;
  return {
    id: e.id,
    name: strField(f, "name") || e.typeName,
    kind: (strField(f, "kind") || "other") as Account["kind"],
    institution: strField(f, "institution"),
    balance: numField(f, "current_balance"),
    currency: strField(f, "currency") || "EUR",
    lastSyncedAt: strField(f, "last_synced_at") || e.updatedAt,
    iban: strField(f, "iban") || undefined,
  };
}

export function entityToAsset(e: EntitySummary): Asset {
  const f = e.fields as Record<string, unknown>;
  return {
    id: e.id,
    name: strField(f, "name") || e.typeName,
    category: (strField(f, "category") || "other") as Asset["category"],
    acquisitionDate: strField(f, "acquisition_date") || e.createdAt,
    acquisitionValue: numField(f, "acquisition_value"),
    currentValue: numField(f, "current_value"),
    accountId: strField(f, "account_id") || undefined,
    ticker: strField(f, "ticker") || undefined,
    symbol: strField(f, "symbol") || undefined,
  };
}

export function entityToLoan(e: EntitySummary): Loan {
  const f = e.fields as Record<string, unknown>;
  return {
    id: e.id,
    name: strField(f, "name") || e.typeName,
    principal: numField(f, "principal"),
    annualRate: numField(f, "annual_rate"),
    termMonths: numField(f, "term_months"),
    startDate: strField(f, "start_date") || e.createdAt,
    kind: (strField(f, "kind") || "other") as Loan["kind"],
    lender: strField(f, "lender"),
  };
}

export function entityToSnapshot(e: EntitySummary): Snapshot {
  const f = e.fields as Record<string, unknown>;
  let breakdown: Snapshot["breakdown"] = {
    cash: 0, stock: 0, crypto: 0, real_estate: 0, bond: 0, other: 0,
  };
  const raw = f["breakdown"];
  if (typeof raw === "string") {
    try { breakdown = JSON.parse(raw) as Snapshot["breakdown"]; } catch { /* ignore */ }
  } else if (raw && typeof raw === "object") {
    breakdown = raw as Snapshot["breakdown"];
  }
  return {
    id: e.id,
    name: strField(f, "name") || new Date(strField(f, "taken_at") || e.createdAt).toLocaleDateString("fr-FR", { month: "long", year: "numeric" }),
    takenAt: strField(f, "taken_at") || e.createdAt,
    totalNetWorth: numField(f, "total_net_worth"),
    breakdown,
    notes: strField(f, "notes") || undefined,
  };
}

export function entityToGoal(e: EntitySummary): Goal {
  const f = e.fields as Record<string, unknown>;
  return {
    id: e.id,
    name: strField(f, "name") || e.typeName,
    targetAmount: numField(f, "target_amount"),
    currentAmount: numField(f, "current_progress"),
    targetDate: strField(f, "target_date") || "",
    category: (strField(f, "category") || "savings") as Goal["category"],
    description: strField(f, "description") || undefined,
  };
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

export interface UseFinanceAccountsResult {
  accounts: Account[];
  isLoading: boolean;
  isFallback: boolean;
}

export function useFinanceAccounts(): UseFinanceAccountsResult {
  const isElectron = useIsElectron();
  const query = trpc.entities.list.useQuery(
    { typeId: "account", limit: 200, offset: 0 },
    { enabled: isElectron },
  );
  if (!isElectron) return { accounts: ACCOUNTS, isLoading: false, isFallback: true };
  if (query.isLoading) return { accounts: [], isLoading: true, isFallback: false };
  if (!query.data) return { accounts: ACCOUNTS, isLoading: false, isFallback: true };
  return {
    accounts: query.data.items.map(entityToAccount),
    isLoading: false,
    isFallback: false,
  };
}

export interface UseFinanceAssetsResult {
  assets: Asset[];
  isLoading: boolean;
  isFallback: boolean;
}

export function useFinanceAssets(): UseFinanceAssetsResult {
  const isElectron = useIsElectron();
  const query = trpc.entities.list.useQuery(
    { typeId: "asset", limit: 500, offset: 0 },
    { enabled: isElectron },
  );
  if (!isElectron) return { assets: ASSETS, isLoading: false, isFallback: true };
  if (query.isLoading) return { assets: [], isLoading: true, isFallback: false };
  if (!query.data) return { assets: ASSETS, isLoading: false, isFallback: true };
  return {
    assets: query.data.items.map(entityToAsset),
    isLoading: false,
    isFallback: false,
  };
}

export interface UseFinanceLoansResult {
  loans: Loan[];
  isLoading: boolean;
  isFallback: boolean;
}

export function useFinanceLoans(): UseFinanceLoansResult {
  const isElectron = useIsElectron();
  const query = trpc.entities.list.useQuery(
    { typeId: "loan", limit: 100, offset: 0 },
    { enabled: isElectron },
  );
  if (!isElectron) return { loans: LOANS, isLoading: false, isFallback: true };
  if (query.isLoading) return { loans: [], isLoading: true, isFallback: false };
  if (!query.data) return { loans: LOANS, isLoading: false, isFallback: true };
  return {
    loans: query.data.items.map(entityToLoan),
    isLoading: false,
    isFallback: false,
  };
}

export interface UseFinanceSnapshotsResult {
  snapshots: Snapshot[];
  isLoading: boolean;
  isFallback: boolean;
}

export function useFinanceSnapshots(): UseFinanceSnapshotsResult {
  const isElectron = useIsElectron();
  const query = trpc.entities.list.useQuery(
    { typeId: "snapshot", sortBy: "taken_at", sortOrder: "desc", limit: 100, offset: 0 },
    { enabled: isElectron },
  );
  if (!isElectron) return { snapshots: SNAPSHOTS, isLoading: false, isFallback: true };
  if (query.isLoading) return { snapshots: [], isLoading: true, isFallback: false };
  if (!query.data) return { snapshots: SNAPSHOTS, isLoading: false, isFallback: true };
  const snaps = query.data.items.map(entityToSnapshot);
  // Sort ascending for chart display (desc from API, reverse for timeline)
  const sorted = [...snaps].sort((a, b) => new Date(a.takenAt).getTime() - new Date(b.takenAt).getTime());
  return { snapshots: sorted, isLoading: false, isFallback: false };
}

export interface UseFinanceGoalsResult {
  goals: Goal[];
  isLoading: boolean;
  isFallback: boolean;
}

export function useFinanceGoals(): UseFinanceGoalsResult {
  const isElectron = useIsElectron();
  const query = trpc.entities.list.useQuery(
    { typeId: "goal", limit: 100, offset: 0 },
    { enabled: isElectron },
  );
  if (!isElectron) return { goals: GOALS, isLoading: false, isFallback: true };
  if (query.isLoading) return { goals: [], isLoading: true, isFallback: false };
  if (!query.data) return { goals: GOALS, isLoading: false, isFallback: true };
  return {
    goals: query.data.items.map(entityToGoal),
    isLoading: false,
    isFallback: false,
  };
}
