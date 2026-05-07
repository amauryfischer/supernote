import { ok, err } from "@supernote/core";
import type {
  QueryAst,
  Filter,
  FilterKey,
  ComparisonOp,
  BoolNode,
  QueryParseResult,
} from "./types.js";
import { tokenize } from "./tokenizer.js";
import type { Token } from "./tokenizer.js";

const VALID_FILTER_KEYS: ReadonlySet<string> = new Set<FilterKey>([
  "path",
  "type",
  "tag",
  "field",
  "created",
  "modified",
  "relation",
  "in",
]);

function parseFilterOp(op: string | undefined): ComparisonOp {
  switch (op) {
    case ">":
      return ">";
    case "<":
      return "<";
    case ">=":
      return ">=";
    case "<=":
      return "<=";
    default:
      return "=";
  }
}

/**
 * Parse a search query string into a structured AST.
 *
 * Grammar (simplified):
 *   query     = token*
 *   token     = BOOL_AND | BOOL_OR | BOOL_NOT | FILTER | PHRASE | EXCLUDE | WORD
 *   FILTER    = key ':' op? value
 *   PHRASE    = '"' .* '"'
 *   EXCLUDE   = '-' word
 */
export function parseQuery(input: string): QueryParseResult {
  if (!input.trim()) {
    return err({ code: "EMPTY_QUERY", message: "Search query is empty" });
  }

  const tokens = tokenize(input);
  const freeText: string[] = [];
  const filters: Filter[] = [];
  const phrases: string[] = [];
  const excluded: string[] = [];
  let bool: BoolNode | null = null;

  // Collect bool-adjacent terms for simple tree building
  const boolTerms: Array<Token> = [];

  for (const token of tokens) {
    switch (token.kind) {
      case "WORD":
        freeText.push(token.value);
        boolTerms.push(token);
        break;

      case "PHRASE":
        phrases.push(token.value);
        break;

      case "EXCLUDE":
        excluded.push(token.value);
        break;

      case "FILTER": {
        const key = token.filterKey ?? "";
        if (!VALID_FILTER_KEYS.has(key)) {
          return err({
            code: "INVALID_FILTER",
            message: `Unknown filter key: "${key}". Valid keys: ${[...VALID_FILTER_KEYS].join(", ")}`,
            position: token.position,
          });
        }
        filters.push({
          key: key as FilterKey,
          value: token.filterValue ?? "",
          op: parseFilterOp(token.filterOp),
        });
        break;
      }

      case "BOOL_AND":
      case "BOOL_OR":
      case "BOOL_NOT":
        boolTerms.push(token);
        break;
    }
  }

  // Build a simple left-associative bool tree from the bool token stream
  bool = buildBoolTree(boolTerms);

  return ok({ freeText, filters, phrases, excluded, bool });
}

/** Build a left-associative boolean tree from mixed WORD/BOOL_* tokens. */
function buildBoolTree(tokens: Token[]): BoolNode | null {
  if (tokens.length === 0) return null;

  // Only build a tree when explicit boolean operators are present
  const hasBool = tokens.some(
    (t) =>
      t.kind === "BOOL_AND" || t.kind === "BOOL_OR" || t.kind === "BOOL_NOT",
  );
  if (!hasBool) return null;

  let i = 0;

  function parsePrimary(): BoolNode | null {
    const t = tokens[i];
    if (!t) return null;

    if (t.kind === "BOOL_NOT") {
      i++;
      const operand = parsePrimary();
      if (!operand) return null;
      return { kind: "NOT", operand };
    }

    if (t.kind === "WORD") {
      i++;
      return { kind: "TERM", value: t.value };
    }

    i++;
    return null;
  }

  function parseExpr(): BoolNode | null {
    let left = parsePrimary();

    while (i < tokens.length) {
      const op = tokens[i];
      if (!op) break;

      if (op.kind === "BOOL_AND") {
        i++;
        const right = parsePrimary();
        if (left && right) left = { kind: "AND", left, right };
      } else if (op.kind === "BOOL_OR") {
        i++;
        const right = parsePrimary();
        if (left && right) left = { kind: "OR", left, right };
      } else {
        break;
      }
    }

    return left;
  }

  return parseExpr();
}
