import { describe, it, expect } from "vitest";
import {
  computeMonthlyPayment,
  computeAmortizationSchedule,
  computeRemainingPrincipal,
  computeEndDate,
  computeTotalInterest,
} from "./index.js";
import type { LoanParams } from "./index.js";

// ---------------------------------------------------------------------------
// Test fixtures (validated against Excel / financial calculator)
// ---------------------------------------------------------------------------

const standardLoan: LoanParams = {
  principal: 200_000,
  annualRate: 0.0344,        // 3.44%
  termMonths: 240,           // 20 years
  startDate: new Date("2024-01-01"),
};

const shortLoan: LoanParams = {
  principal: 10_000,
  annualRate: 0.06,          // 6%
  termMonths: 12,            // 1 year
  startDate: new Date("2024-01-01"),
};

// ---------------------------------------------------------------------------
// computeMonthlyPayment
// ---------------------------------------------------------------------------

describe("computeMonthlyPayment", () => {
  it("computes correct payment for standard loan", () => {
    // PMT(3.44%/12, 240, -200000) = 1153.76
    const payment = computeMonthlyPayment(standardLoan);
    expect(payment).toBeCloseTo(1153.76, 0);
  });

  it("computes correct payment for 6% 12-month loan", () => {
    // Excel PMT(6%/12, 12, -10000) ≈ 860.66
    const payment = computeMonthlyPayment(shortLoan);
    expect(payment).toBeCloseTo(860.66, 0);
  });

  it("returns principal / termMonths when rate is 0%", () => {
    const zeroRate: LoanParams = { ...standardLoan, annualRate: 0 };
    const payment = computeMonthlyPayment(zeroRate);
    expect(payment).toBeCloseTo(200_000 / 240, 2);
  });

  it("returns 0 for zero principal", () => {
    const noLoan: LoanParams = { ...standardLoan, principal: 0 };
    expect(computeMonthlyPayment(noLoan)).toBe(0);
  });

  it("handles 1-month term correctly", () => {
    const oneMonth: LoanParams = {
      principal: 5000,
      annualRate: 0.12,
      termMonths: 1,
      startDate: new Date("2024-01-01"),
    };
    // Full principal + 1 month interest
    const payment = computeMonthlyPayment(oneMonth);
    expect(payment).toBeCloseTo(5050, 0);
  });
});

// ---------------------------------------------------------------------------
// computeAmortizationSchedule
// ---------------------------------------------------------------------------

describe("computeAmortizationSchedule", () => {
  it("returns exactly termMonths rows", () => {
    const schedule = computeAmortizationSchedule(standardLoan);
    expect(schedule).toHaveLength(240);
  });

  it("last row has near-zero remaining principal", () => {
    const schedule = computeAmortizationSchedule(standardLoan);
    const last = schedule[schedule.length - 1];
    // Allow up to ~1 EUR rounding due to fixed-payment rounding over 240 periods
    expect(last?.remaining).toBeLessThan(2);
  });

  it("sum of principal payments equals original principal within rounding", () => {
    const schedule = computeAmortizationSchedule(standardLoan);
    const totalPrincipal = schedule.reduce((s, r) => s + r.principal, 0);
    // Allow up to ~1 EUR rounding due to cent-rounding over 240 periods
    expect(Math.abs(totalPrincipal - standardLoan.principal)).toBeLessThan(2);
  });

  it("interest is decreasing over time (French amortization)", () => {
    const schedule = computeAmortizationSchedule(standardLoan);
    // First interest > last interest
    expect(schedule[0]!.interest).toBeGreaterThan(schedule[schedule.length - 1]!.interest);
  });

  it("period numbers are sequential starting at 1", () => {
    const schedule = computeAmortizationSchedule(shortLoan);
    schedule.forEach((row, i) => {
      expect(row.period).toBe(i + 1);
    });
  });

  it("each payment = interest + principal", () => {
    const schedule = computeAmortizationSchedule(shortLoan);
    for (const row of schedule) {
      expect(row.payment).toBeCloseTo(row.interest + row.principal, 1);
    }
  });

  it("first row date is one month after start date", () => {
    const schedule = computeAmortizationSchedule(shortLoan);
    const firstDate = schedule[0]!.date;
    expect(firstDate.getFullYear()).toBe(2024);
    expect(firstDate.getMonth()).toBe(1); // February
  });
});

// ---------------------------------------------------------------------------
// computeRemainingPrincipal
// ---------------------------------------------------------------------------

describe("computeRemainingPrincipal", () => {
  it("returns full principal before start", () => {
    const before = new Date("2023-12-01");
    const remaining = computeRemainingPrincipal(standardLoan, before);
    expect(remaining).toBe(standardLoan.principal);
  });

  it("returns near-zero after loan term", () => {
    const after = new Date("2045-01-01");
    const remaining = computeRemainingPrincipal(standardLoan, after);
    expect(remaining).toBeLessThan(2);
  });

  it("returns partial amount midway through loan", () => {
    const midway = new Date("2034-01-01"); // ~10 years in on 20-year loan
    const remaining = computeRemainingPrincipal(standardLoan, midway);
    expect(remaining).toBeGreaterThan(0);
    expect(remaining).toBeLessThan(standardLoan.principal);
  });
});

// ---------------------------------------------------------------------------
// computeEndDate
// ---------------------------------------------------------------------------

describe("computeEndDate", () => {
  it("returns correct end date for 20-year loan", () => {
    const end = computeEndDate(standardLoan);
    expect(end.getFullYear()).toBe(2044);
    expect(end.getMonth()).toBe(0); // January
  });

  it("returns correct end date for 1-year loan", () => {
    const end = computeEndDate(shortLoan);
    expect(end.getFullYear()).toBe(2025);
    expect(end.getMonth()).toBe(0); // January
  });
});

// ---------------------------------------------------------------------------
// computeTotalInterest
// ---------------------------------------------------------------------------

describe("computeTotalInterest", () => {
  it("returns positive total interest for standard loan", () => {
    const total = computeTotalInterest(standardLoan);
    expect(total).toBeGreaterThan(0);
  });

  it("total cost = principal + total interest", () => {
    const monthly = computeMonthlyPayment(standardLoan);
    const totalPaid = monthly * standardLoan.termMonths;
    const totalInterest = computeTotalInterest(standardLoan);
    expect(totalInterest).toBeCloseTo(totalPaid - standardLoan.principal, -1);
  });

  it("returns 0 total interest for zero-rate loan", () => {
    const zeroRate: LoanParams = { ...standardLoan, annualRate: 0 };
    expect(computeTotalInterest(zeroRate)).toBeCloseTo(0, 1);
  });
});
