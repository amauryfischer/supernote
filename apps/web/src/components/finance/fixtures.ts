// Fixtures for the finance dashboard
// Default: empty. Use demo-fixtures.ts for demo data.

export interface Account {
  id: string;
  name: string;
  kind: "checking" | "savings" | "livret" | "pea" | "cto" | "assurance_vie" | "crypto" | "other";
  institution: string;
  balance: number;
  currency: string;
  lastSyncedAt: string;
  iban?: string;
}

export interface Asset {
  id: string;
  name: string;
  category: "real_estate" | "stock" | "crypto" | "bond" | "fund" | "cash" | "other";
  acquisitionDate: string;
  acquisitionValue: number;
  currentValue: number;
  accountId?: string;
  ticker?: string;
  symbol?: string;
}

export interface Loan {
  id: string;
  name: string;
  principal: number;
  annualRate: number;
  termMonths: number;
  startDate: string;
  kind: "mortgage" | "consumer" | "personal" | "auto" | "student" | "other";
  lender: string;
}

export interface Snapshot {
  id: string;
  name: string;
  takenAt: string;
  totalNetWorth: number;
  breakdown: {
    cash: number;
    stock: number;
    crypto: number;
    real_estate: number;
    bond: number;
    other: number;
  };
  notes?: string;
}

export interface Goal {
  id: string;
  name: string;
  targetAmount: number;
  currentAmount: number;
  targetDate: string;
  category: "savings" | "investment" | "debt" | "patrimony";
  description?: string;
}

export const ACCOUNTS: Account[] = [];

export const ASSETS: Asset[] = [];

export const LOANS: Loan[] = [];

export const SNAPSHOTS: Snapshot[] = [];

export const GOALS: Goal[] = [];
