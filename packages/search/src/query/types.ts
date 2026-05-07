import type { Result } from "@supernote/core";

// ---------------------------------------------------------------------------
// Filter keys supported by the query language
// ---------------------------------------------------------------------------

export type FilterKey =
  | "path"
  | "type"
  | "tag"
  | "field"
  | "created"
  | "modified"
  | "relation"
  | "in";

export type ComparisonOp = "=" | ">" | "<" | ">=" | "<=";

export interface Filter {
  readonly key: FilterKey;
  /** Raw value string (without operator prefix) */
  readonly value: string;
  readonly op: ComparisonOp;
}

// ---------------------------------------------------------------------------
// Boolean tree (top-level AND/OR/NOT keyword nodes)
// ---------------------------------------------------------------------------

export type BoolNode =
  | { readonly kind: "AND"; readonly left: BoolNode; readonly right: BoolNode }
  | { readonly kind: "OR"; readonly left: BoolNode; readonly right: BoolNode }
  | { readonly kind: "NOT"; readonly operand: BoolNode }
  | { readonly kind: "TERM"; readonly value: string };

// ---------------------------------------------------------------------------
// AST produced by parseQuery
// ---------------------------------------------------------------------------

export interface QueryAst {
  /** Simple words fed to FTS */
  readonly freeText: string[];
  /** Structured key:value filters */
  readonly filters: Filter[];
  /** Exact phrase matches (quoted strings) */
  readonly phrases: string[];
  /** Excluded terms (prefixed with -) */
  readonly excluded: string[];
  /** Boolean tree (AND/OR/NOT operators) — null when absent */
  readonly bool: BoolNode | null;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export interface QueryParseError {
  readonly code: "PARSE_ERROR" | "INVALID_FILTER" | "EMPTY_QUERY";
  readonly message: string;
  readonly position?: number;
}

export type QueryParseResult = Result<QueryAst, QueryParseError>;

// ---------------------------------------------------------------------------
// Compiled SQL + FTS expression
// ---------------------------------------------------------------------------

export interface CompiledQuery {
  readonly ftsExpr: string;
  readonly sqlPredicates: ReadonlyArray<{
    readonly sql: string;
    readonly params: unknown[];
  }>;
}
