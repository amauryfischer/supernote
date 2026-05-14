// ============================================================
// Hand-written lexer for the Supernote formula language
// ============================================================

import type { Position } from "./ast.js";
import { makeParseError, type ParseError } from "./errors.js";
import type { Result } from "@supernote/core/result";
import { ok, err } from "@supernote/core/result";

export type TokenKind =
  | "Number"
  | "String"
  | "Bool"
  | "Null"
  | "Identifier"
  | "Arrow"       // ->
  | "Plus" | "Minus" | "Star" | "Slash" | "Percent"
  | "EqEq" | "BangEq" | "Lt" | "LtEq" | "Gt" | "GtEq"
  | "And" | "Or" | "Not"
  | "LParen" | "RParen" | "LBracket" | "RBracket"
  | "Comma" | "Dot" | "At"
  | "LWikiLink" | "RWikiLink"  // [[ and ]]
  | "EOF";

export interface Token {
  readonly kind: TokenKind;
  readonly raw: string;
  readonly pos: Position;
}

export class Lexer {
  private offset = 0;
  private line = 1;
  private col = 1;

  constructor(private readonly src: string) {}

  tokenize(): Result<Token[], ParseError> {
    const tokens: Token[] = [];
    while (true) {
      const t = this.nextToken();
      if (!t.ok) return t;
      tokens.push(t.value);
      if (t.value.kind === "EOF") break;
    }
    return ok(tokens);
  }

  private pos(): Position {
    return { line: this.line, col: this.col, offset: this.offset };
  }

  private peek(ahead = 0): string {
    return this.src[this.offset + ahead] ?? "";
  }

  private advance(): string {
    const ch = this.src[this.offset] ?? "";
    this.offset++;
    if (ch === "\n") { this.line++; this.col = 1; } else { this.col++; }
    return ch;
  }

  private skipWhitespaceAndComments(): void {
    while (this.offset < this.src.length) {
      const ch = this.peek();
      if (ch === " " || ch === "\t" || ch === "\r" || ch === "\n") {
        this.advance();
      } else if (ch === "/" && this.peek(1) === "/") {
        while (this.offset < this.src.length && this.peek() !== "\n") this.advance();
      } else {
        break;
      }
    }
  }

  private nextToken(): Result<Token, ParseError> {
    this.skipWhitespaceAndComments();
    if (this.offset >= this.src.length) {
      return ok({ kind: "EOF", raw: "", pos: this.pos() });
    }

    const start = this.pos();
    const ch = this.peek();

    if (ch === "[" && this.peek(1) === "[") {
      return this.readWikiLink(start);
    }
    if (ch === "]" && this.peek(1) === "]") {
      this.advance(); this.advance();
      return ok({ kind: "RWikiLink", raw: "]]", pos: start });
    }
    // {field name or slug} — Coda-style placeholder; emitted as Identifier
    // whose raw is `_f_<sanitized>` so it matches the worker's scope keys.
    if (ch === "{") {
      return this.readFieldRef(start);
    }

    if (ch === "-" && this.peek(1) === ">") {
      this.advance(); this.advance();
      return ok({ kind: "Arrow", raw: "->", pos: start });
    }

    if (ch === "!" && this.peek(1) === "=") {
      this.advance(); this.advance();
      return ok({ kind: "BangEq", raw: "!=", pos: start });
    }
    // Coda-style "<>" for not-equal
    if (ch === "<" && this.peek(1) === ">") {
      this.advance(); this.advance();
      return ok({ kind: "BangEq", raw: "<>", pos: start });
    }
    if (ch === "=" && this.peek(1) === "=") {
      this.advance(); this.advance();
      return ok({ kind: "EqEq", raw: "==", pos: start });
    }
    if (ch === "<" && this.peek(1) === "=") {
      this.advance(); this.advance();
      return ok({ kind: "LtEq", raw: "<=", pos: start });
    }
    if (ch === ">" && this.peek(1) === "=") {
      this.advance(); this.advance();
      return ok({ kind: "GtEq", raw: ">=", pos: start });
    }
    // Coda-style "&&" / "||" boolean operators
    if (ch === "&" && this.peek(1) === "&") {
      this.advance(); this.advance();
      return ok({ kind: "And", raw: "&&", pos: start });
    }
    if (ch === "|" && this.peek(1) === "|") {
      this.advance(); this.advance();
      return ok({ kind: "Or", raw: "||", pos: start });
    }
    // Bare "=" used as equality in Coda formulas
    if (ch === "=" && this.peek(1) !== "=") {
      this.advance();
      return ok({ kind: "EqEq", raw: "=", pos: start });
    }

    const single = SINGLE_CHAR_TOKENS[ch];
    if (single !== undefined) {
      this.advance();
      return ok({ kind: single, raw: ch, pos: start });
    }

    if (ch === '"' || ch === "'") return this.readString(start, ch);
    if (isDigit(ch) || (ch === "." && isDigit(this.peek(1)))) return this.readNumber(start);
    if (isAlpha(ch) || ch === "_") return this.readIdent(start);
    if (ch === "@") return this.readEntityRef(start);

    this.advance();
    return err(makeParseError(`Unexpected character '${ch}'`, start));
  }

  private readString(start: Position, quote: string): Result<Token, ParseError> {
    this.advance(); // consume opening quote
    let value = "";
    while (this.offset < this.src.length && this.peek() !== quote) {
      if (this.peek() === "\\") {
        this.advance();
        const esc = this.advance();
        value += ESCAPE_MAP[esc] ?? esc;
      } else {
        value += this.advance();
      }
    }
    if (this.offset >= this.src.length) {
      return err(makeParseError("Unterminated string literal", start));
    }
    this.advance(); // consume closing quote
    return ok({ kind: "String", raw: JSON.stringify(value), pos: start });
  }

  private readNumber(start: Position): Result<Token, ParseError> {
    let raw = "";
    while (isDigit(this.peek())) raw += this.advance();
    if (this.peek() === "." && isDigit(this.peek(1))) {
      raw += this.advance();
      while (isDigit(this.peek())) raw += this.advance();
    }
    if (this.peek() === "e" || this.peek() === "E") {
      raw += this.advance();
      if (this.peek() === "+" || this.peek() === "-") raw += this.advance();
      while (isDigit(this.peek())) raw += this.advance();
    }
    return ok({ kind: "Number", raw, pos: start });
  }

  private readIdent(start: Position): Result<Token, ParseError> {
    let raw = "";
    while (isAlphaNum(this.peek()) || this.peek() === "_") raw += this.advance();
    // Coda is case-insensitive for keywords (TRUE, FALSE, AND, OR, NOT, NULL)
    const kind = KEYWORD_MAP[raw.toLowerCase()];
    if (kind === "Bool" || kind === "Null" || kind === "And" || kind === "Or" || kind === "Not") {
      return ok({ kind, raw, pos: start });
    }
    return ok({ kind: "Identifier", raw, pos: start });
  }

  private readEntityRef(start: Position): Result<Token, ParseError> {
    this.advance(); // consume @
    let name = "";
    while (isAlphaNum(this.peek()) || this.peek() === "_") name += this.advance();
    return ok({ kind: "Identifier", raw: `@${name}`, pos: start });
  }

  /** Read {field name} → Identifier with sanitized raw `_f_<safe>` */
  private readFieldRef(start: Position): Result<Token, ParseError> {
    this.advance(); // consume {
    let inner = "";
    while (this.offset < this.src.length && this.peek() !== "}") {
      inner += this.advance();
    }
    if (this.offset >= this.src.length) {
      return err(makeParseError("Unterminated field reference '{...'", start));
    }
    this.advance(); // consume }
    const safe = "_f_" + inner.trim().replace(/[^A-Za-z0-9_]/g, "_");
    return ok({ kind: "Identifier", raw: safe, pos: start });
  }

  /** Read a full [[...]] wikilink as a single token */
  private readWikiLink(start: Position): Result<Token, ParseError> {
    this.advance(); this.advance(); // consume [[
    let title = "";
    while (this.offset < this.src.length) {
      if (this.peek() === "]" && this.peek(1) === "]") {
        this.advance(); this.advance(); // consume ]]
        return ok({ kind: "LWikiLink", raw: title, pos: start });
      }
      title += this.advance();
    }
    return err(makeParseError("Unterminated wikilink '[[...'", start));
  }
}

// ------ helpers ----------------------------------------------

function isDigit(ch: string): boolean { return ch >= "0" && ch <= "9"; }
function isAlpha(ch: string): boolean {
  return (ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z");
}
function isAlphaNum(ch: string): boolean { return isAlpha(ch) || isDigit(ch); }

const SINGLE_CHAR_TOKENS: Record<string, TokenKind> = {
  "+": "Plus", "-": "Minus", "*": "Star", "/": "Slash", "%": "Percent",
  "<": "Lt", ">": "Gt",
  "(": "LParen", ")": "RParen",
  "[": "LBracket", "]": "RBracket",
  ",": "Comma", ".": "Dot",
};

const KEYWORD_MAP: Record<string, TokenKind> = {
  true: "Bool", false: "Bool",
  null: "Null",
  and: "And", or: "Or", not: "Not",
};

const ESCAPE_MAP: Record<string, string> = {
  n: "\n", t: "\t", r: "\r",
  '"': '"', "'": "'", "\\": "\\",
};
