import type { Entity } from "@supernote/core/types";
import type { PricingEngine } from "../pricing/index.js";

export interface NetWorthBreakdown {
  readonly cash: number;
  readonly realEstate: number;
  readonly stocks: number;
  readonly crypto: number;
  readonly bonds: number;
  readonly funds: number;
  readonly other: number;
  readonly liabilities: number;
  readonly total: number;
  readonly byCurrency: Record<string, number>;
}

export interface GoalProgress {
  readonly goalId: string;
  readonly targetAmount: number;
  readonly currentAmount: number;
  readonly progressPercent: number;
  readonly remainingAmount: number;
  readonly eta: Date | null;
}

export type SnapshotEntity = Entity & {
  fields: {
    taken_at?: string | Date;
    total_net_worth?: number;
    breakdown?: string;
  };
};

export type GoalEntity = Entity & {
  fields: {
    target_amount?: number;
    target_date?: string | Date;
    current_progress?: number;
  };
};

type AssetCategory =
  | "real_estate"
  | "stock"
  | "crypto"
  | "bond"
  | "fund"
  | "cash"
  | "other";

/**
 * Aggregates entity fields into a net worth breakdown.
 * Entities with typeId 'Account' or category 'cash' sum into cash bucket.
 * Liabilities come from entities with typeId 'Loan'.
 */
export async function computeBreakdown(
  entities: Entity[],
  _pricing: PricingEngine,
  _baseCurrency = "EUR",
): Promise<NetWorthBreakdown> {
  let cash = 0;
  let realEstate = 0;
  let stocks = 0;
  let crypto = 0;
  let bonds = 0;
  let funds = 0;
  let other = 0;
  let liabilities = 0;
  const byCurrency: Record<string, number> = {};

  for (const entity of entities) {
    const fields = entity.fields as Record<string, unknown>;
    const typeName = (fields["_typeName"] as string | undefined) ?? "";
    const category = (fields["category"] as AssetCategory | undefined) ?? "other";
    const value = numericField(fields["current_value"] ?? fields["current_balance"]);
    const currency = (fields["currency"] as string | undefined) ?? _baseCurrency;

    if (typeName === "Loan") {
      const remaining = numericField(fields["remaining_principal"] ?? fields["principal"]);
      liabilities += remaining;
    } else if (typeName === "Account") {
      cash += value;
    } else if (typeName === "Asset") {
      switch (category) {
        case "real_estate": realEstate += value; break;
        case "stock": stocks += value; break;
        case "crypto": crypto += value; break;
        case "bond": bonds += value; break;
        case "fund": funds += value; break;
        case "cash": cash += value; break;
        default: other += value; break;
      }
    } else {
      other += value;
    }

    if (value !== 0) {
      byCurrency[currency] = (byCurrency[currency] ?? 0) + value;
    }
  }

  const assets = cash + realEstate + stocks + crypto + bonds + funds + other;

  return {
    cash,
    realEstate,
    stocks,
    crypto,
    bonds,
    funds,
    other,
    liabilities,
    total: round2(assets - liabilities),
    byCurrency,
  };
}

/**
 * Computes goal progress from current snapshot data.
 */
export function computeProgress(
  snapshots: SnapshotEntity[],
  goal: GoalEntity,
): GoalProgress {
  const targetAmount = numericField(goal.fields["target_amount"]);
  const currentAmount = numericField(goal.fields["current_progress"]);
  const progressPercent = targetAmount > 0 ? (currentAmount / targetAmount) * 100 : 0;
  const eta = projectETA(snapshots, targetAmount);

  return {
    goalId: goal.id,
    targetAmount,
    currentAmount,
    progressPercent: round2(progressPercent),
    remainingAmount: round2(Math.max(0, targetAmount - currentAmount)),
    eta,
  };
}

/**
 * Projects ETA using linear regression on snapshot net worth values.
 * Returns null if fewer than 2 data points or trend is not positive.
 */
export function projectETA(
  snapshots: SnapshotEntity[],
  target: number,
): Date | null {
  const points = snapshots
    .map((s) => ({
      x: toTimestamp(s.fields["taken_at"]),
      y: numericField(s.fields["total_net_worth"]),
    }))
    .filter((p) => p.x > 0)
    .sort((a, b) => a.x - b.x);

  if (points.length < 2) return null;

  const { slope, intercept } = linearRegression(points);
  if (slope <= 0) return null;

  const targetTime = (target - intercept) / slope;
  if (targetTime <= Date.now()) return null;

  return new Date(targetTime);
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function numericField(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const n = parseFloat(v);
    return isNaN(n) ? 0 : n;
  }
  return 0;
}

function toTimestamp(v: unknown): number {
  if (v instanceof Date) return v.getTime();
  if (typeof v === "string") return new Date(v).getTime();
  if (typeof v === "number") return v;
  return 0;
}

function linearRegression(
  points: Array<{ x: number; y: number }>,
): { slope: number; intercept: number } {
  const n = points.length;
  const sumX = points.reduce((s, p) => s + p.x, 0);
  const sumY = points.reduce((s, p) => s + p.y, 0);
  const sumXY = points.reduce((s, p) => s + p.x * p.y, 0);
  const sumX2 = points.reduce((s, p) => s + p.x * p.x, 0);
  const denom = n * sumX2 - sumX * sumX;
  if (denom === 0) return { slope: 0, intercept: sumY / n };
  const slope = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;
  return { slope, intercept };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
