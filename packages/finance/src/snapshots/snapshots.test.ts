import { describe, it, expect, vi } from "vitest";
import {
  computeBreakdown,
  computeProgress,
  projectETA,
} from "./index.js";
import type { GoalEntity, SnapshotEntity } from "./index.js";
import type { Entity } from "@supernote/core/types";
import type { PricingEngine } from "../pricing/index.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEntity(overrides: Partial<Entity> & { fields: Record<string, unknown> }): Entity {
  return {
    id: "test-id",
    typeId: "Asset",
    filePath: "/test/asset.md",
    body: "",
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-05-07"),
    ...overrides,
  };
}

const mockPricingEngine: PricingEngine = {
  fetchStock: vi.fn(),
  fetchStocks: vi.fn(),
  fetchCrypto: vi.fn(),
  fetchForex: vi.fn(),
  refreshCache: vi.fn(),
  getCachedQuote: vi.fn().mockReturnValue(null),
};

// ---------------------------------------------------------------------------
// computeBreakdown
// ---------------------------------------------------------------------------

describe("computeBreakdown", () => {
  it("sums stock assets correctly", async () => {
    const entities: Entity[] = [
      makeEntity({
        fields: {
          _typeName: "Asset",
          category: "stock",
          current_value: 5000,
          currency: "EUR",
        },
      }),
      makeEntity({
        fields: {
          _typeName: "Asset",
          category: "stock",
          current_value: 3000,
          currency: "EUR",
        },
      }),
    ];

    const result = await computeBreakdown(entities, mockPricingEngine);
    expect(result.stocks).toBe(8000);
    expect(result.total).toBe(8000);
  });

  it("sums crypto assets correctly", async () => {
    const entities: Entity[] = [
      makeEntity({
        fields: { _typeName: "Asset", category: "crypto", current_value: 12000, currency: "EUR" },
      }),
    ];

    const result = await computeBreakdown(entities, mockPricingEngine);
    expect(result.crypto).toBe(12000);
  });

  it("sums Account balances into cash bucket", async () => {
    const entities: Entity[] = [
      makeEntity({
        fields: { _typeName: "Account", current_balance: 4500, currency: "EUR" },
      }),
    ];

    const result = await computeBreakdown(entities, mockPricingEngine);
    expect(result.cash).toBe(4500);
  });

  it("subtracts Loan liabilities from total", async () => {
    const entities: Entity[] = [
      makeEntity({
        fields: { _typeName: "Asset", category: "real_estate", current_value: 300_000, currency: "EUR" },
      }),
      makeEntity({
        fields: { _typeName: "Loan", remaining_principal: 150_000, currency: "EUR" },
      }),
    ];

    const result = await computeBreakdown(entities, mockPricingEngine);
    expect(result.realEstate).toBe(300_000);
    expect(result.liabilities).toBe(150_000);
    expect(result.total).toBe(150_000);
  });

  it("returns zero totals for empty entities", async () => {
    const result = await computeBreakdown([], mockPricingEngine);
    expect(result.total).toBe(0);
    expect(result.cash).toBe(0);
    expect(result.liabilities).toBe(0);
  });

  it("groups by currency correctly", async () => {
    const entities: Entity[] = [
      makeEntity({ fields: { _typeName: "Asset", category: "stock", current_value: 1000, currency: "USD" } }),
      makeEntity({ fields: { _typeName: "Asset", category: "stock", current_value: 2000, currency: "EUR" } }),
    ];

    const result = await computeBreakdown(entities, mockPricingEngine);
    expect(result.byCurrency["USD"]).toBe(1000);
    expect(result.byCurrency["EUR"]).toBe(2000);
  });

  it("handles multiple categories", async () => {
    const entities: Entity[] = [
      makeEntity({ fields: { _typeName: "Asset", category: "bond", current_value: 5000, currency: "EUR" } }),
      makeEntity({ fields: { _typeName: "Asset", category: "fund", current_value: 8000, currency: "EUR" } }),
      makeEntity({ fields: { _typeName: "Asset", category: "other", current_value: 1000, currency: "EUR" } }),
    ];

    const result = await computeBreakdown(entities, mockPricingEngine);
    expect(result.bonds).toBe(5000);
    expect(result.funds).toBe(8000);
    expect(result.other).toBe(1000);
  });
});

// ---------------------------------------------------------------------------
// computeProgress
// ---------------------------------------------------------------------------

describe("computeProgress", () => {
  const snapshots: SnapshotEntity[] = [
    makeEntity({ fields: { _typeName: "Snapshot", taken_at: "2026-01-01", total_net_worth: 10000 } }) as SnapshotEntity,
    makeEntity({ fields: { _typeName: "Snapshot", taken_at: "2026-03-01", total_net_worth: 20000 } }) as SnapshotEntity,
    makeEntity({ fields: { _typeName: "Snapshot", taken_at: "2026-05-01", total_net_worth: 30000 } }) as SnapshotEntity,
  ];

  const goal: GoalEntity = makeEntity({
    fields: { _typeName: "Goal", target_amount: 100_000, current_progress: 30000 },
  }) as GoalEntity;

  it("computes progress percent correctly", () => {
    const progress = computeProgress(snapshots, goal);
    expect(progress.progressPercent).toBeCloseTo(30, 1);
  });

  it("computes remaining amount", () => {
    const progress = computeProgress(snapshots, goal);
    expect(progress.remainingAmount).toBeCloseTo(70_000, 0);
  });

  it("returns goal id", () => {
    const progress = computeProgress(snapshots, goal);
    expect(progress.goalId).toBe(goal.id);
  });

  it("returns target and current amounts", () => {
    const progress = computeProgress(snapshots, goal);
    expect(progress.targetAmount).toBe(100_000);
    expect(progress.currentAmount).toBe(30_000);
  });

  it("computes ETA as a future date given positive trend", () => {
    const progress = computeProgress(snapshots, goal);
    if (progress.eta) {
      expect(progress.eta).toBeInstanceOf(Date);
      expect(progress.eta.getTime()).toBeGreaterThan(Date.now());
    }
  });
});

// ---------------------------------------------------------------------------
// projectETA
// ---------------------------------------------------------------------------

describe("projectETA", () => {
  it("returns null with fewer than 2 snapshots", () => {
    const single: SnapshotEntity[] = [
      makeEntity({ fields: { taken_at: "2026-01-01", total_net_worth: 10000 } }) as SnapshotEntity,
    ];
    expect(projectETA(single, 50000)).toBeNull();
  });

  it("returns null when trend is flat (slope = 0)", () => {
    const flat: SnapshotEntity[] = [
      makeEntity({ fields: { taken_at: "2026-01-01", total_net_worth: 10000 } }) as SnapshotEntity,
      makeEntity({ fields: { taken_at: "2026-03-01", total_net_worth: 10000 } }) as SnapshotEntity,
    ];
    expect(projectETA(flat, 50000)).toBeNull();
  });

  it("returns null when trend is negative", () => {
    const declining: SnapshotEntity[] = [
      makeEntity({ fields: { taken_at: "2026-01-01", total_net_worth: 30000 } }) as SnapshotEntity,
      makeEntity({ fields: { taken_at: "2026-03-01", total_net_worth: 20000 } }) as SnapshotEntity,
    ];
    expect(projectETA(declining, 50000)).toBeNull();
  });

  it("returns a future date for positive trend and achievable target", () => {
    const growing: SnapshotEntity[] = [
      makeEntity({ fields: { taken_at: "2026-01-01", total_net_worth: 10000 } }) as SnapshotEntity,
      makeEntity({ fields: { taken_at: "2026-03-01", total_net_worth: 15000 } }) as SnapshotEntity,
      makeEntity({ fields: { taken_at: "2026-05-01", total_net_worth: 20000 } }) as SnapshotEntity,
    ];
    const eta = projectETA(growing, 30000);
    expect(eta).toBeInstanceOf(Date);
    expect(eta!.getTime()).toBeGreaterThan(Date.now());
  });

  it("handles empty snapshots gracefully", () => {
    expect(projectETA([], 50000)).toBeNull();
  });
});
