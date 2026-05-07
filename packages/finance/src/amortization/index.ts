export interface LoanParams {
  readonly principal: number;
  readonly annualRate: number;
  readonly termMonths: number;
  readonly startDate: Date;
  readonly paymentFrequency?: "monthly" | "biweekly";
  readonly loanKind?: "fixed" | "variable";
}

export interface AmortizationRow {
  readonly period: number;
  readonly date: Date;
  readonly payment: number;
  readonly principal: number;
  readonly interest: number;
  readonly remaining: number;
}

/**
 * Computes the fixed monthly payment using the standard annuity formula.
 * If rate is 0, returns principal / termMonths.
 */
export function computeMonthlyPayment(p: LoanParams): number {
  if (p.principal <= 0) return 0;
  const monthlyRate = p.annualRate / 12;
  if (monthlyRate === 0) return p.principal / p.termMonths;
  const factor = Math.pow(1 + monthlyRate, p.termMonths);
  return (p.principal * monthlyRate * factor) / (factor - 1);
}

/**
 * Builds the full amortization schedule (French method: fixed payment,
 * decreasing interest, increasing principal).
 */
export function computeAmortizationSchedule(p: LoanParams): AmortizationRow[] {
  const payment = computeMonthlyPayment(p);
  const monthlyRate = p.annualRate / 12;
  const rows: AmortizationRow[] = [];
  let remaining = p.principal;

  for (let period = 1; period <= p.termMonths; period++) {
    const date = addMonths(p.startDate, period);
    const interest = round2(remaining * monthlyRate);
    const principalPaid = round2(Math.min(payment - interest, remaining));
    remaining = round2(remaining - principalPaid);
    rows.push({ period, date, payment: round2(payment), principal: principalPaid, interest, remaining: Math.max(0, remaining) });
  }
  return rows;
}

/**
 * Returns the remaining principal at a given date by summing paid periods.
 */
export function computeRemainingPrincipal(p: LoanParams, asOf: Date): number {
  const schedule = computeAmortizationSchedule(p);
  for (let i = schedule.length - 1; i >= 0; i--) {
    const row = schedule[i];
    if (row && row.date <= asOf) return row.remaining;
  }
  return p.principal;
}

/** Returns the date of the last payment. */
export function computeEndDate(p: LoanParams): Date {
  return addMonths(p.startDate, p.termMonths);
}

/** Returns total interest paid over the full term. */
export function computeTotalInterest(p: LoanParams): number {
  const schedule = computeAmortizationSchedule(p);
  return round2(schedule.reduce((sum, row) => sum + row.interest, 0));
}

function addMonths(date: Date, months: number): Date {
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);
  return d;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
