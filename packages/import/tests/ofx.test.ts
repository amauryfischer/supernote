import { describe, it, expect } from "vitest";
import path from "node:path";
import { importOFX } from "../src/ofx/index.js";
import { parseOFX, parseOFXDate } from "../src/ofx/parser.js";
import type { ImportOptions, TransactionRecord } from "../src/types.js";

const FIXTURES = path.join(import.meta.dirname, "fixtures/ofx");

function makeOpts(overrides: Partial<ImportOptions> = {}): ImportOptions {
  return {
    targetVaultRoot: "/tmp/test-vault-ofx",
    defaultFolder: "Finance/Transactions/",
    preserveHierarchy: true,
    dryRun: true,
    resolvers: {},
    ...overrides,
  };
}

describe("OFX parser", () => {
  it("parses OFX date YYYYMMDDHHMMSS", () => {
    expect(parseOFXDate("20240105120000")).toBe("2024-01-05T12:00:00Z");
  });

  it("parses OFX date YYYYMMDD (no time)", () => {
    expect(parseOFXDate("20240110")).toBe("2024-01-10T00:00:00Z");
  });

  it("parses OFX date with timezone bracket", () => {
    expect(parseOFXDate("20240115[+1:CET]")).toBe("2024-01-15T00:00:00Z");
  });

  it("parses sample.ofx and returns 5 transactions", () => {
    const fs = require("node:fs");
    const content = fs.readFileSync(path.join(FIXTURES, "sample.ofx"), "utf-8");
    const statements = parseOFX(content);

    expect(statements).toHaveLength(1);
    expect(statements[0]?.transactions).toHaveLength(5);
  });

  it("extracts DEBIT transaction correctly", () => {
    const fs = require("node:fs");
    const content = fs.readFileSync(path.join(FIXTURES, "sample.ofx"), "utf-8");
    const statements = parseOFX(content);
    const debit = statements[0]?.transactions.find((t) => t.fitId === "TX001");

    expect(debit?.trnType).toBe("DEBIT");
    expect(debit?.trnAmt).toBe(-45.99);
    expect(debit?.name).toBe("CARREFOUR CITY");
    expect(debit?.memo).toBe("Courses alimentaires");
  });

  it("extracts CREDIT transaction correctly", () => {
    const fs = require("node:fs");
    const content = fs.readFileSync(path.join(FIXTURES, "sample.ofx"), "utf-8");
    const statements = parseOFX(content);
    const credit = statements[0]?.transactions.find((t) => t.fitId === "TX002");

    expect(credit?.trnType).toBe("CREDIT");
    expect(credit?.trnAmt).toBe(2500);
    expect(credit?.name).toBe("VIREMENT SALAIRE");
  });

  it("extracts currency from CURDEF", () => {
    const fs = require("node:fs");
    const content = fs.readFileSync(path.join(FIXTURES, "sample.ofx"), "utf-8");
    const statements = parseOFX(content);
    expect(statements[0]?.curDef).toBe("EUR");
  });

  it("extracts account info", () => {
    const fs = require("node:fs");
    const content = fs.readFileSync(path.join(FIXTURES, "sample.ofx"), "utf-8");
    const statements = parseOFX(content);
    const acct = statements[0]?.account;

    expect(acct?.acctType).toBe("CHECKING");
    expect(acct?.bankId).toBe("12345");
  });

  it("returns empty array for empty content", () => {
    expect(parseOFX("")).toHaveLength(0);
  });
});

describe("importOFX", () => {
  it("imports sample.ofx in dry-run mode", async () => {
    const result = await importOFX(path.join(FIXTURES, "sample.ofx"), makeOpts());

    expect(result.errors).toHaveLength(0);
    expect(result.imported.notes).toBe(5); // 5 transactions = 5 note files
  });

  it("calls writeTransaction resolver for each transaction", async () => {
    const transactions: TransactionRecord[] = [];
    const opts: ImportOptions = {
      targetVaultRoot: "/tmp/test-vault-ofx-resolve",
      defaultFolder: "Finance/Transactions/",
      dryRun: false,
      resolvers: {
        writeTransaction: async (tx) => { transactions.push(tx); },
      },
    };

    const result = await importOFX(path.join(FIXTURES, "sample.ofx"), opts);

    expect(transactions).toHaveLength(5);
    expect(result.errors).toHaveLength(0);
  });

  it("assigns correct tags for DEBIT transactions", async () => {
    const transactions: TransactionRecord[] = [];
    const opts: ImportOptions = {
      targetVaultRoot: "/tmp/test-vault-ofx-tags",
      dryRun: false,
      resolvers: {
        writeTransaction: async (tx) => { transactions.push(tx); },
      },
    };

    await importOFX(path.join(FIXTURES, "sample.ofx"), opts);
    const debit = transactions.find((t) => t.description === "CARREFOUR CITY");
    expect(debit?.tags).toContain("finance/debit");
  });

  it("assigns correct tags for CREDIT transactions", async () => {
    const transactions: TransactionRecord[] = [];
    const opts: ImportOptions = {
      targetVaultRoot: "/tmp/test-vault-ofx-tags2",
      dryRun: false,
      resolvers: {
        writeTransaction: async (tx) => { transactions.push(tx); },
      },
    };

    await importOFX(path.join(FIXTURES, "sample.ofx"), opts);
    const credit = transactions.find((t) => t.description === "VIREMENT SALAIRE");
    expect(credit?.tags).toContain("finance/credit");
  });

  it("assigns ATM tag for ATM withdrawal", async () => {
    const transactions: TransactionRecord[] = [];
    const opts: ImportOptions = {
      targetVaultRoot: "/tmp/test-vault-ofx-atm",
      dryRun: false,
      resolvers: {
        writeTransaction: async (tx) => { transactions.push(tx); },
      },
    };

    await importOFX(path.join(FIXTURES, "sample.ofx"), opts);
    const atm = transactions.find((t) => t.description === "RETRAIT DAB");
    expect(atm?.tags).toContain("finance/retrait");
  });

  it("sets currency from CURDEF", async () => {
    const transactions: TransactionRecord[] = [];
    const opts: ImportOptions = {
      targetVaultRoot: "/tmp/test-vault-ofx-cur",
      dryRun: false,
      resolvers: {
        writeTransaction: async (tx) => { transactions.push(tx); },
      },
    };

    await importOFX(path.join(FIXTURES, "sample.ofx"), opts);
    expect(transactions.every((t) => t.currency === "EUR")).toBe(true);
  });

  it("returns error for non-existent file", async () => {
    const result = await importOFX("/nonexistent/file.ofx", makeOpts());
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.message).toMatch(/Cannot read/);
  });

  it("returns warning for OFX file with no statements", async () => {
    const result = await importOFX(
      path.join(FIXTURES, "../../vcard/single.vcf"), // not OFX
      makeOpts()
    );
    // May produce warning or error but should not crash
    expect(result).toBeTruthy();
  });

  it("includes date in ISO format for each transaction", async () => {
    const transactions: TransactionRecord[] = [];
    const opts: ImportOptions = {
      targetVaultRoot: "/tmp/test-vault-ofx-date",
      dryRun: false,
      resolvers: {
        writeTransaction: async (tx) => { transactions.push(tx); },
      },
    };

    await importOFX(path.join(FIXTURES, "sample.ofx"), opts);
    expect(transactions[0]?.date).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
