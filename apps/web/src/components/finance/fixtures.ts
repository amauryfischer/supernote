// Mock data fixtures for the finance dashboard

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

export const ACCOUNTS: Account[] = [
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
  {
    id: "acc-4",
    name: "Compte épargne",
    kind: "savings",
    institution: "Crédit Agricole",
    balance: 8_200.00,
    currency: "EUR",
    lastSyncedAt: "2026-05-05T12:00:00Z",
  },
  {
    id: "acc-5",
    name: "Wallet crypto",
    kind: "crypto",
    institution: "Ledger",
    balance: 12_480.25,
    currency: "EUR",
    lastSyncedAt: "2026-05-07T08:00:00Z",
  },
];

export const ASSETS: Asset[] = [
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
    name: "LVMH (MC.PA)",
    category: "stock",
    acquisitionDate: "2021-11-10",
    acquisitionValue: 8_500,
    currentValue: 9_720,
    accountId: "acc-3",
    ticker: "MC.PA",
  },
  {
    id: "ast-4",
    name: "CAC 40 ETF",
    category: "fund",
    acquisitionDate: "2023-01-05",
    acquisitionValue: 12_000,
    currentValue: 14_380,
    accountId: "acc-3",
    ticker: "CW8.PA",
  },
  {
    id: "ast-5",
    name: "Bitcoin (BTC)",
    category: "crypto",
    acquisitionDate: "2021-04-20",
    acquisitionValue: 8_000,
    currentValue: 9_250,
    accountId: "acc-5",
    symbol: "BTC",
  },
  {
    id: "ast-6",
    name: "Ethereum (ETH)",
    category: "crypto",
    acquisitionDate: "2022-09-15",
    acquisitionValue: 3_500,
    currentValue: 3_230,
    accountId: "acc-5",
    symbol: "ETH",
  },
  {
    id: "ast-7",
    name: "OAT France 2031",
    category: "bond",
    acquisitionDate: "2023-06-01",
    acquisitionValue: 10_000,
    currentValue: 10_240,
    accountId: undefined,
  },
  {
    id: "ast-8",
    name: "Assurance-vie UC",
    category: "fund",
    acquisitionDate: "2020-01-15",
    acquisitionValue: 15_000,
    currentValue: 18_920,
    accountId: undefined,
  },
  {
    id: "ast-9",
    name: "Tesla (TSLA)",
    category: "stock",
    acquisitionDate: "2023-03-10",
    acquisitionValue: 3_600,
    currentValue: 2_840,
    accountId: "acc-3",
    ticker: "TSLA",
  },
  {
    id: "ast-10",
    name: "Nvidia (NVDA)",
    category: "stock",
    acquisitionDate: "2023-07-01",
    acquisitionValue: 5_200,
    currentValue: 8_640,
    accountId: "acc-3",
    ticker: "NVDA",
  },
  {
    id: "ast-11",
    name: "Solana (SOL)",
    category: "crypto",
    acquisitionDate: "2024-01-10",
    acquisitionValue: 2_000,
    currentValue: 1_840,
    accountId: "acc-5",
    symbol: "SOL",
  },
  {
    id: "ast-12",
    name: "Cave à vin Bordeaux",
    category: "other",
    acquisitionDate: "2022-04-01",
    acquisitionValue: 4_500,
    currentValue: 5_200,
    accountId: undefined,
  },
];

export const LOANS: Loan[] = [
  {
    id: "loan-1",
    name: "Crédit immobilier Paris 11e",
    principal: 240_000,
    annualRate: 0.0185,
    termMonths: 240,
    startDate: "2019-04-01",
    kind: "mortgage",
    lender: "BNP Paribas",
  },
  {
    id: "loan-2",
    name: "Prêt voiture",
    principal: 18_000,
    annualRate: 0.0399,
    termMonths: 48,
    startDate: "2023-09-01",
    kind: "auto",
    lender: "Crédit Agricole",
  },
];

// 6 monthly snapshots (1 per month, last 6 months)
export const SNAPSHOTS: Snapshot[] = [
  {
    id: "snap-1",
    name: "Novembre 2025",
    takenAt: "2025-11-30T23:00:00Z",
    totalNetWorth: 468_200,
    breakdown: { cash: 28_500, stock: 38_400, crypto: 14_200, real_estate: 385_000, bond: 9_800, other: 4_500 },
    notes: "Début de période",
  },
  {
    id: "snap-2",
    name: "Décembre 2025",
    takenAt: "2025-12-31T23:00:00Z",
    totalNetWorth: 478_500,
    breakdown: { cash: 31_200, stock: 40_100, crypto: 15_800, real_estate: 385_000, bond: 9_900, other: 4_800 },
  },
  {
    id: "snap-3",
    name: "Janvier 2026",
    takenAt: "2026-01-31T23:00:00Z",
    totalNetWorth: 484_100,
    breakdown: { cash: 29_800, stock: 41_500, crypto: 14_600, real_estate: 392_000, bond: 10_000, other: 4_900 },
  },
  {
    id: "snap-4",
    name: "Février 2026",
    takenAt: "2026-02-28T23:00:00Z",
    totalNetWorth: 491_750,
    breakdown: { cash: 32_400, stock: 43_200, crypto: 13_900, real_estate: 395_000, bond: 10_050, other: 5_000 },
  },
  {
    id: "snap-5",
    name: "Mars 2026",
    takenAt: "2026-03-31T23:00:00Z",
    totalNetWorth: 502_300,
    breakdown: { cash: 34_800, stock: 45_600, crypto: 15_200, real_estate: 400_000, bond: 10_100, other: 5_100 },
  },
  {
    id: "snap-6",
    name: "Avril 2026",
    takenAt: "2026-04-30T23:00:00Z",
    totalNetWorth: 518_940,
    breakdown: { cash: 35_400, stock: 48_200, crypto: 14_800, real_estate: 410_000, bond: 10_200, other: 5_200 },
  },
];

export const GOALS: Goal[] = [
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
    description: "Objectif ETF + actions long terme",
  },
  {
    id: "goal-3",
    name: "Remboursement crédit voiture",
    targetAmount: 18_000,
    currentAmount: 11_250,
    targetDate: "2027-09-01",
    category: "debt",
    description: "Remboursement anticipé prêt auto",
  },
  {
    id: "goal-4",
    name: "Patrimoine net 750k",
    targetAmount: 750_000,
    currentAmount: 518_940,
    targetDate: "2032-01-01",
    category: "patrimony",
    description: "Objectif patrimoine global",
  },
];
