// Minimal OFX (Open Financial Exchange) SGML/XML parser

export interface OFXTransaction {
  readonly trnType: string;   // DEBIT, CREDIT, etc.
  readonly dtPosted: string;  // YYYYMMDDHHMMSS
  readonly trnAmt: number;
  readonly fitId: string;
  readonly name: string;
  readonly memo?: string;
  readonly currency?: string;
}

export interface OFXAccount {
  readonly bankId?: string;
  readonly acctId: string;
  readonly acctType: string;  // CHECKING, SAVINGS, etc.
}

export interface OFXStatement {
  readonly curDef: string;
  readonly account: OFXAccount;
  readonly transactions: OFXTransaction[];
}

/** Extract tag value from OFX SGML content */
function extractTag(content: string, tag: string): string | undefined {
  const re = new RegExp(`<${tag}>([^<\n\r]+)`, "i");
  const m = re.exec(content);
  return m?.[1]?.trim();
}

/** Extract all occurrences of a transaction block */
function extractTransactionBlocks(content: string): string[] {
  const blocks: string[] = [];
  const re = /<STMTTRN>([\s\S]*?)<\/STMTTRN>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(content)) !== null) {
    if (match[1]) blocks.push(match[1]);
  }
  return blocks;
}

/** Parse OFX date to ISO string */
export function parseOFXDate(raw: string): string {
  const clean = raw.replace(/\[.*\]/, "").trim();
  const y = clean.slice(0, 4);
  const mo = clean.slice(4, 6) || "01";
  const d = clean.slice(6, 8) || "01";
  const h = clean.slice(8, 10) || "00";
  const mi = clean.slice(10, 12) || "00";
  const s = clean.slice(12, 14) || "00";
  return `${y}-${mo}-${d}T${h}:${mi}:${s}Z`;
}

/** Parse a single transaction block */
function parseTransaction(block: string): OFXTransaction | null {
  const trnType = extractTag(block, "TRNTYPE") ?? "UNKNOWN";
  const dtPosted = extractTag(block, "DTPOSTED");
  const trnAmt = extractTag(block, "TRNAMT");
  const fitId = extractTag(block, "FITID");
  const name = extractTag(block, "NAME") ?? extractTag(block, "MEMO") ?? "";
  const memo = extractTag(block, "MEMO");

  if (!dtPosted || !trnAmt || !fitId) return null;

  return {
    trnType,
    dtPosted: parseOFXDate(dtPosted),
    trnAmt: parseFloat(trnAmt.replace(",", ".")),
    fitId,
    name: name.trim(),
    memo: memo?.trim(),
  };
}

/** Parse OFX account info */
function parseAccount(content: string): OFXAccount {
  const bankAcct = /<BANKACCTFROM>([\s\S]*?)<\/BANKACCTFROM>/i.exec(content)?.[1] ?? content;
  return {
    bankId: extractTag(bankAcct, "BANKID"),
    acctId: extractTag(bankAcct, "ACCTID") ?? "unknown",
    acctType: extractTag(bankAcct, "ACCTTYPE") ?? "CHECKING",
  };
}

/** Parse full OFX file content */
export function parseOFX(content: string): OFXStatement[] {
  // Handle both SGML (old OFX) and XML-wrapped OFX
  const statements: OFXStatement[] = [];

  // Find all STMTRS blocks (bank statement responses)
  const stmtBlocks = extractAllStatements(content);

  for (const block of stmtBlocks) {
    const curDef = extractTag(block, "CURDEF") ?? "EUR";
    const account = parseAccount(block);
    const txBlocks = extractTransactionBlocks(block);
    const transactions = txBlocks
      .map(parseTransaction)
      .filter((t): t is OFXTransaction => t !== null);

    statements.push({ curDef, account, transactions });
  }

  return statements;
}

/** Extract all STMTRS/CCSTMTRS blocks */
function extractAllStatements(content: string): string[] {
  const blocks: string[] = [];
  const patterns = [/<STMTRS>([\s\S]*?)<\/STMTRS>/gi, /<CCSTMTRS>([\s\S]*?)<\/CCSTMTRS>/gi];

  for (const re of patterns) {
    let match: RegExpExecArray | null;
    while ((match = re.exec(content)) !== null) {
      if (match[1]) blocks.push(match[1]);
    }
  }

  // Fallback: try SGML style without closing tags
  if (blocks.length === 0) {
    const m = /<STMTRS>([\s\S]*)/i.exec(content);
    if (m?.[1]) blocks.push(m[1]);
  }

  return blocks;
}
