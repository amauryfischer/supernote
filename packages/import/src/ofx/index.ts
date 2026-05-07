import fs from "node:fs/promises";
import path from "node:path";
import type { ImportOptions, ImportResult, TransactionRecord } from "../types.js";
import {
  emptyResult,
  addError,
  addWarning,
} from "../utils/result.js";
import { generateId } from "../utils/id.js";
import { buildMarkdown } from "../utils/markdown.js";
import { logger } from "../utils/logger.js";
import { parseOFX, type OFXTransaction, type OFXAccount } from "./parser.js";

/** Map OFX transaction type to Supernote tags */
function ofxTypeToTags(trnType: string): string[] {
  const mapping: Record<string, string> = {
    DEBIT: "finance/debit",
    CREDIT: "finance/credit",
    INT: "finance/interet",
    DIV: "finance/dividende",
    FEE: "finance/frais",
    SRVCHG: "finance/frais-service",
    DEP: "finance/depot",
    ATM: "finance/retrait",
    POS: "finance/pos",
    XFER: "finance/virement",
    CHECK: "finance/cheque",
    PAYMENT: "finance/paiement",
    CASH: "finance/especes",
    DIRECTDEP: "finance/virement-direct",
    DIRECTDEBIT: "finance/prelevement",
    REPEATPMT: "finance/paiement-recurrent",
    OTHER: "finance/autre",
  };
  const tag = mapping[trnType.toUpperCase()];
  return tag ? [tag] : ["finance/transaction"];
}

/** Build account name string from OFX account info */
function accountName(account: OFXAccount): string {
  return account.acctId ? `${account.acctType}-${account.acctId.slice(-4)}` : account.acctType;
}

/** Convert OFX transaction to TransactionRecord */
function buildTransactionRecord(
  tx: OFXTransaction,
  account: OFXAccount,
  currency: string,
  opts: ImportOptions
): TransactionRecord {
  const id = generateId();
  const tags = ofxTypeToTags(tx.trnType);
  const accName = accountName(account);
  const folder = opts.defaultFolder ?? "Finance/Transactions/";
  const dateSlug = tx.dtPosted.slice(0, 10);
  const safeId = tx.fitId.replace(/[^a-zA-Z0-9-]/g, "").slice(0, 30);
  const filePath = path.join(opts.targetVaultRoot, folder, `${dateSlug}-${safeId}.md`);

  return {
    id,
    filePath,
    date: tx.dtPosted,
    amount: tx.trnAmt,
    currency,
    description: tx.name || tx.memo || "Transaction",
    tags,
    accountName: accName,
  };
}

/** Build markdown content for a transaction */
function buildTransactionMarkdown(record: TransactionRecord): string {
  const fm: Record<string, unknown> = {
    id: record.id,
    type: "transaction",
    created: new Date().toISOString(),
    updated: new Date().toISOString(),
    source: "ofx",
    tags: record.tags,
    fields: {
      date: record.date,
      amount: record.amount,
      currency: record.currency,
      description: record.description,
      accountName: record.accountName,
      transactionType: record.tags[0] ?? "finance/transaction",
    },
  };

  const body = [
    `# ${record.description}`,
    "",
    `| Field | Value |`,
    `|---|---|`,
    `| Date | ${record.date.slice(0, 10)} |`,
    `| Amount | ${record.amount} ${record.currency} |`,
    `| Account | ${record.accountName ?? "—"} |`,
    `| Type | ${record.tags.join(", ")} |`,
  ].join("\n");

  return buildMarkdown(fm, body);
}

/** Main OFX importer */
export async function importOFX(
  filePath: string,
  opts: ImportOptions
): Promise<ImportResult> {
  logger.info({ filePath }, "Starting OFX import");
  let result = emptyResult();

  let content: string;
  try {
    content = await fs.readFile(filePath, "utf-8");
  } catch (err) {
    return addError(emptyResult(), filePath, `Cannot read OFX file: ${String(err)}`, err);
  }

  let statements;
  try {
    statements = parseOFX(content);
  } catch (err) {
    return addError(emptyResult(), filePath, `Cannot parse OFX: ${String(err)}`, err);
  }

  if (statements.length === 0) {
    result = addWarning(result, "No statements found in OFX file.");
    return result;
  }

  for (const stmt of statements) {
    const accName = accountName(stmt.account);
    logger.info({ account: accName, txCount: stmt.transactions.length }, "Processing statement");

    for (const tx of stmt.transactions) {
      try {
        const record = buildTransactionRecord(tx, stmt.account, stmt.curDef, opts);

        if (!opts.dryRun) {
          await fs.mkdir(path.dirname(record.filePath), { recursive: true });
          await fs.writeFile(record.filePath, buildTransactionMarkdown(record), "utf-8");
          await opts.resolvers.writeTransaction?.(record);
        }

        result = {
          ...result,
          imported: {
            ...result.imported,
            notes: result.imported.notes + 1,
          },
        };
        logger.debug({ id: record.id, amount: record.amount }, "Imported transaction");
      } catch (err) {
        logger.error({ err, fitId: tx.fitId }, "Error processing OFX transaction");
        result = addError(result, tx.fitId, String(err), err);
      }
    }
  }

  logger.info({ result }, "OFX import complete");
  return result;
}
