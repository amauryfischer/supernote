export type { EntityTypeDefinition } from "./types.js";
export { accountSeed } from "./account.js";
export { assetSeed } from "./asset.js";
export { loanSeed } from "./loan.js";
export { snapshotSeed } from "./snapshot.js";
export { goalSeed } from "./goal.js";

export const FINANCE_SEEDS = ["Account", "Asset", "Loan", "Snapshot", "Goal"] as const;
export type FinanceSeedName = (typeof FINANCE_SEEDS)[number];
