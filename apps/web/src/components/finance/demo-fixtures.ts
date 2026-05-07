/**
 * Demo fixtures for finance — used by the "Charger des exemples (démo)" button in Settings > Backup.
 * These are NOT loaded by default. The app starts empty.
 */
import type { Account, Asset, Loan, Snapshot, Goal } from "./fixtures";

export const DEMO_ACCOUNTS: Account[] = [
  {
    id: "acc-1",
    name: "Compte courant BNP",
    kind: "checking",
    institution: "BNP Paribas",
    balance: 4_250.80,
    currency: "EUR",
    lastSyncedAt: "2026-05-06T18:00:00Z",
    iban: "FR76 3000 4028 3700 0100 0000 000",
  },
  {
    id: "acc-2",
    name: "Livret A",
    kind: "livret",
    institution: "BNP Paribas",
    balance: 22_950.00,
    currency: "EUR",
    lastSyncedAt: "2026-05-06T18:00:00Z",
  },
  {
    id: "acc-3",
    name: "PEA Bourse",
    kind: "pea",
    institution: "Boursorama",
    balance: 38_640.50,
    currency: "EUR",
    lastSyncedAt: "2026-05-07T09:15:00Z",
  },
];

export const DEMO_ASSETS: Asset[] = [
  {
    id: "ast-1",
    name: "Appartement Paris 11e",
    category: "real_estate",
    acquisitionDate: "2019-03-15",
    acquisitionValue: 320_000,
    currentValue: 410_000,
    accountId: undefined,
  },
  {
    id: "ast-2",
    name: "Apple (AAPL)",
    category: "stock",
    acquisitionDate: "2022-06-01",
    acquisitionValue: 4_200,
    currentValue: 6_840,
    accountId: "acc-3",
    ticker: "AAPL",
  },
  {
    id: "ast-3",
    name: "CAC 40 ETF",
    category: "fund",
    acquisitionDate: "2023-01-05",
    acquisitionValue: 12_000,
    currentValue: 14_380,
    accountId: "acc-3",
    ticker: "CW8.PA",
  },
  {
    id: "ast-4",
    name: "Bitcoin (BTC)",
    category: "crypto",
    acquisitionDate: "2021-04-20",
    acquisitionValue: 8_000,
    currentValue: 9_250,
    accountId: undefined,
    symbol: "BTC",
  },
];

export const DEMO_LOANS: Loan[] = [
  {
    id: "loan-1",
    name: "Crédit immobilier",
    principal: 240_000,
    annualRate: 0.0185,
    termMonths: 240,
    startDate: "2019-04-01",
    kind: "mortgage",
    lender: "BNP Paribas",
  },
];

export const DEMO_SNAPSHOTS: Snapshot[] = [
  {
    id: "snap-1",
    name: "Mars 2026",
    takenAt: "2026-03-31T23:00:00Z",
    totalNetWorth: 502_300,
    breakdown: { cash: 34_800, stock: 45_600, crypto: 15_200, real_estate: 400_000, bond: 10_100, other: 5_100 },
  },
  {
    id: "snap-2",
    name: "Avril 2026",
    takenAt: "2026-04-30T23:00:00Z",
    totalNetWorth: 518_940,
    breakdown: { cash: 35_400, stock: 48_200, crypto: 14_800, real_estate: 410_000, bond: 10_200, other: 5_200 },
  },
];

export const DEMO_GOALS: Goal[] = [
  {
    id: "goal-1",
    name: "Apport résidence principale",
    targetAmount: 80_000,
    currentAmount: 53_200,
    targetDate: "2027-06-01",
    category: "savings",
    description: "Apport pour achat RP en région parisienne",
  },
  {
    id: "goal-2",
    name: "Portefeuille boursier 100k",
    targetAmount: 100_000,
    currentAmount: 66_440,
    targetDate: "2028-12-31",
    category: "investment",
  },
];
