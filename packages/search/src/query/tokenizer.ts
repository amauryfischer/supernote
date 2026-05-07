/** Token types emitted by the tokenizer */
export type TokenKind =
  | "WORD"
  | "PHRASE"
  | "FILTER"
  | "EXCLUDE"
  | "BOOL_AND"
  | "BOOL_OR"
  | "BOOL_NOT";

export interface Token {
  readonly kind: TokenKind;
  /** Raw string content */
  readonly raw: string;
  /** Parsed value (key for FILTER, word for WORD/EXCLUDE, phrase for PHRASE) */
  readonly value: string;
  /** Only for FILTER tokens */
  readonly filterKey?: string;
  readonly filterValue?: string;
  readonly filterOp?: string;
  readonly position: number;
}

const FILTER_RE =
  /^([a-z_]+):(>=|<=|>|<)?(.+)$/;

const BOOL_KEYWORDS = new Set(["AND", "OR", "NOT"]);

/** Tokenize a raw search query string into structured tokens. */
export function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const s = input.trim();

  while (i < s.length) {
    // Skip whitespace
    if (/\s/.test(s[i] ?? "")) {
      i++;
      continue;
    }

    const start = i;

    // Quoted phrase: "..."
    if (s[i] === '"') {
      let j = i + 1;
      while (j < s.length && s[j] !== '"') j++;
      const phrase = s.slice(i + 1, j);
      tokens.push({ kind: "PHRASE", raw: s.slice(i, j + 1), value: phrase, position: start });
      i = j + 1;
      continue;
    }

    // Read a raw token (until whitespace)
    let j = i;
    while (j < s.length && !/\s/.test(s[j] ?? "")) j++;
    const raw = s.slice(i, j);
    i = j;

    // Excluded term: -word or -"phrase" (handle separately above for phrases)
    if (raw.startsWith("-") && raw.length > 1) {
      tokens.push({ kind: "EXCLUDE", raw, value: raw.slice(1), position: start });
      continue;
    }

    // Boolean keywords
    if (BOOL_KEYWORDS.has(raw)) {
      const kind =
        raw === "AND" ? "BOOL_AND" : raw === "OR" ? "BOOL_OR" : "BOOL_NOT";
      tokens.push({ kind, raw, value: raw, position: start });
      continue;
    }

    // Filter: key:value or key:>value
    const filterMatch = FILTER_RE.exec(raw);
    if (filterMatch) {
      const [, filterKey, op, filterValue] = filterMatch;
      tokens.push({
        kind: "FILTER",
        raw,
        value: raw,
        filterKey: filterKey ?? "",
        filterOp: op ?? "=",
        filterValue: filterValue ?? "",
        position: start,
      });
      continue;
    }

    // Plain word
    tokens.push({ kind: "WORD", raw, value: raw, position: start });
  }

  return tokens;
}
