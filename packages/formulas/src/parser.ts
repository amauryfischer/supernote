// ============================================================
// Recursive descent parser for the Supernote formula language
//
// Choice: hand-written recursive descent over Lezer.
// Rationale: no build-time code generation step, zero extra
// dependencies, straightforward error recovery with positions,
// and the grammar fits comfortably in <300 LOC of TS.
// ============================================================

import type { Token, TokenKind } from "./lexer.js";
import { Lexer } from "./lexer.js";
import type {
  FormulaAST,
  Span,
  Position,
  BinaryOperator,
} from "./ast.js";
import { makeParseError, type ParseError } from "./errors.js";
import type { Result } from "@supernote/core/result";
import { ok, err } from "@supernote/core/result";

export function parseFormula(source: string): Result<FormulaAST, ParseError> {
  const lexResult = new Lexer(source).tokenize();
  if (!lexResult.ok) return lexResult;
  const parser = new Parser(lexResult.value, source);
  return parser.parse();
}

class Parser {
  private pos = 0;

  constructor(
    private readonly tokens: Token[],
    private readonly source: string,
  ) {}

  parse(): Result<FormulaAST, ParseError> {
    const result = this.parseExpr();
    if (!result.ok) return result;
    if (!this.isAtEnd()) {
      return err(makeParseError(
        `Unexpected token '${this.current().raw}'`,
        this.current().pos,
        this.source,
      ));
    }
    return result;
  }

  // ---- expression hierarchy (lowest precedence first) -------

  private parseExpr(): Result<FormulaAST, ParseError> {
    return this.parseLambdaOrBinary();
  }

  /** Detects   x -> body   or   (a, b) -> body   before binary */
  private parseLambdaOrBinary(): Result<FormulaAST, ParseError> {
    const saved = this.pos;
    const lambdaResult = this.tryLambda();
    if (lambdaResult !== null) return lambdaResult;
    this.pos = saved;
    return this.parseOr();
  }

  private tryLambda(): Result<FormulaAST, ParseError> | null {
    const start = this.current().pos;
    // Single param: ident ->
    if (this.check("Identifier") && this.peek(1)?.kind === "Arrow") {
      const paramTok = this.advance();
      const param = paramTok.raw.startsWith("@") ? paramTok.raw.slice(1) : paramTok.raw;
      this.advance(); // ->
      const bodyResult = this.parseExpr();
      if (!bodyResult.ok) return bodyResult;
      return ok({
        kind: "Lambda",
        params: [param],
        body: bodyResult.value,
        span: span(start, bodyResult.value.span.end),
      });
    }
    // Multi param: ( ident , ident ) ->
    if (this.check("LParen")) {
      const saved2 = this.pos;
      this.pos++; // (
      const params: string[] = [];
      while (this.check("Identifier")) {
        const t = this.advance();
        params.push(t.raw);
        if (!this.check("Comma")) break;
        this.pos++;
      }
      if (params.length > 0 && this.check("RParen") && this.peek(1)?.kind === "Arrow") {
        this.pos++; // )
        this.pos++; // ->
        const bodyResult = this.parseExpr();
        if (!bodyResult.ok) return bodyResult;
        return ok({
          kind: "Lambda",
          params,
          body: bodyResult.value,
          span: span(start, bodyResult.value.span.end),
        });
      }
      this.pos = saved2;
    }
    return null;
  }

  private parseOr(): Result<FormulaAST, ParseError> {
    return this.parseBinary(
      () => this.parseAnd(),
      ["Or"],
      { Or: "or" },
    );
  }

  private parseAnd(): Result<FormulaAST, ParseError> {
    return this.parseBinary(
      () => this.parseEquality(),
      ["And"],
      { And: "and" },
    );
  }

  private parseEquality(): Result<FormulaAST, ParseError> {
    return this.parseBinary(
      () => this.parseComparison(),
      ["EqEq", "BangEq"],
      { EqEq: "==", BangEq: "!=" },
    );
  }

  private parseComparison(): Result<FormulaAST, ParseError> {
    return this.parseBinary(
      () => this.parseAddSub(),
      ["Lt", "LtEq", "Gt", "GtEq"],
      { Lt: "<", LtEq: "<=", Gt: ">", GtEq: ">=" },
    );
  }

  private parseAddSub(): Result<FormulaAST, ParseError> {
    return this.parseBinary(
      () => this.parseMulDiv(),
      ["Plus", "Minus"],
      { Plus: "+", Minus: "-" },
    );
  }

  private parseMulDiv(): Result<FormulaAST, ParseError> {
    return this.parseBinary(
      () => this.parseUnary(),
      ["Star", "Slash", "Percent"],
      { Star: "*", Slash: "/", Percent: "%" },
    );
  }

  private parseBinary(
    sub: () => Result<FormulaAST, ParseError>,
    ops: TokenKind[],
    opMap: Partial<Record<TokenKind, BinaryOperator>>,
  ): Result<FormulaAST, ParseError> {
    let left = sub();
    if (!left.ok) return left;
    while (ops.some((op) => this.check(op))) {
      const opTok = this.advance();
      const op = opMap[opTok.kind as TokenKind] ?? (opTok.raw as BinaryOperator);
      const right = sub();
      if (!right.ok) return right;
      left = ok({
        kind: "BinaryOp",
        op,
        left: left.value,
        right: right.value,
        span: span(left.value.span.start, right.value.span.end),
      });
    }
    return left;
  }

  private parseUnary(): Result<FormulaAST, ParseError> {
    const start = this.current().pos;
    if (this.check("Minus")) {
      this.advance();
      const operand = this.parseUnary();
      if (!operand.ok) return operand;
      return ok({ kind: "UnaryOp", op: "-", operand: operand.value, span: span(start, operand.value.span.end) });
    }
    if (this.check("Not")) {
      this.advance();
      const operand = this.parseUnary();
      if (!operand.ok) return operand;
      return ok({ kind: "UnaryOp", op: "not", operand: operand.value, span: span(start, operand.value.span.end) });
    }
    return this.parsePostfix();
  }

  /** Handles property access and Coda-style chaining: a.b.c, a.Fn(x) */
  private parsePostfix(): Result<FormulaAST, ParseError> {
    let base = this.parsePrimary();
    if (!base.ok) return base;
    while (this.check("Dot")) {
      this.advance();
      if (!this.check("Identifier")) {
        return err(makeParseError("Expected property name after '.'", this.current().pos, this.source));
      }
      const prop = this.advance();
      // Chaining: base.Fn(args) — desugared to Fn(base, args...)
      if (this.check("LParen")) {
        const callRes = this.parseFunctionCall(prop.raw, base.value.span.start);
        if (!callRes.ok) return callRes;
        const call = callRes.value as { kind: "FunctionCall"; name: string; args: FormulaAST[]; span: Span };
        // Coda-style `.where(expr)` / `.WhereBy(expr)` — auto-wrap the
        // predicate as `currentValue -> expr` so users can write
        // `list.where(currentValue.age > 18)` without an explicit lambda.
        const nameLower = call.name.toLowerCase();
        const autoLambdaMethods = new Set(["where", "whereby"]);
        let wrappedArgs = call.args;
        if (autoLambdaMethods.has(nameLower) && call.args.length === 1) {
          const arg = call.args[0]!;
          if (arg.kind !== "Lambda") {
            wrappedArgs = [{
              kind: "Lambda",
              params: ["currentValue"],
              body: arg,
              span: arg.span,
            }];
          }
        }
        // Normalize method name to canonical stdlib entry (Filter).
        const normalizedName = autoLambdaMethods.has(nameLower) ? "Filter" : call.name;
        base = ok({
          kind: "FunctionCall",
          name: normalizedName,
          args: [base.value, ...wrappedArgs],
          span: span(base.value.span.start, call.span.end),
        });
        continue;
      }
      base = ok({
        kind: "PropertyAccess",
        object: base.value,
        property: prop.raw,
        span: span(base.value.span.start, prop.pos),
      });
    }
    return base;
  }

  private parsePrimary(): Result<FormulaAST, ParseError> {
    const tok = this.current();
    const start = tok.pos;

    // WikiLink [[...]] — lexer emits a single LWikiLink token with title in raw
    if (this.check("LWikiLink")) {
      const wlTok = this.advance();
      return ok({ kind: "WikiLink", title: wlTok.raw, span: span(start, wlTok.pos) });
    }

    // @EntityRef
    if (this.check("Identifier") && tok.raw.startsWith("@")) {
      this.advance();
      return ok({ kind: "EntityRef", ref: tok.raw.slice(1), span: span(start, start) });
    }

    // Function call or plain identifier
    if (this.check("Identifier")) {
      this.advance();
      if (this.check("LParen")) {
        return this.parseFunctionCall(tok.raw, start);
      }
      return ok({ kind: "Identifier", name: tok.raw, span: span(start, start) });
    }

    // Number
    if (this.check("Number")) {
      this.advance();
      return ok({ kind: "NumberLiteral", value: Number(tok.raw), span: span(start, start) });
    }

    // String
    if (this.check("String")) {
      this.advance();
      const value = JSON.parse(tok.raw) as string;
      return ok({ kind: "StringLiteral", value, span: span(start, start) });
    }

    // Bool — case-insensitive (Coda accepts TRUE/FALSE/True/False)
    if (this.check("Bool")) {
      this.advance();
      return ok({ kind: "BoolLiteral", value: tok.raw.toLowerCase() === "true", span: span(start, start) });
    }

    // Null
    if (this.check("Null")) {
      this.advance();
      return ok({ kind: "NullLiteral", span: span(start, start) });
    }

    // Grouping (...)
    if (this.check("LParen")) {
      this.advance();
      const inner = this.parseExpr();
      if (!inner.ok) return inner;
      if (!this.check("RParen")) {
        return err(makeParseError("Expected ')' to close '('", this.current().pos, this.source));
      }
      const endPos = this.advance().pos;
      // Return the inner node with updated span
      const node = inner.value;
      return ok({ ...node, span: span(start, endPos) } as FormulaAST);
    }

    // List literal [...]
    if (this.check("LBracket")) {
      this.advance();
      const elements: FormulaAST[] = [];
      while (!this.check("RBracket") && !this.isAtEnd()) {
        const el = this.parseExpr();
        if (!el.ok) return el;
        elements.push(el.value);
        if (this.check("Comma")) this.advance();
      }
      if (!this.check("RBracket")) {
        return err(makeParseError("Expected ']' to close '['", this.current().pos, this.source));
      }
      const endPos = this.advance().pos;
      return ok({ kind: "ListLiteral", elements, span: span(start, endPos) });
    }

    if (this.isAtEnd()) {
      return err(makeParseError("Unexpected end of input", start, this.source));
    }
    return err(makeParseError(`Unexpected token '${tok.raw}'`, start, this.source));
  }

  private parseFunctionCall(name: string, start: Position): Result<FormulaAST, ParseError> {
    this.advance(); // consume (
    const args: FormulaAST[] = [];
    while (!this.check("RParen") && !this.isAtEnd()) {
      const arg = this.parseExpr();
      if (!arg.ok) return arg;
      args.push(arg.value);
      if (this.check("Comma")) this.advance();
    }
    if (!this.check("RParen")) {
      return err(makeParseError(`Expected ')' after arguments of '${name}'`, this.current().pos, this.source));
    }
    const endPos = this.advance().pos;
    // `Where(list, expr)` / `WhereBy(list, expr)` — auto-wrap predicate.
    const nameLower = name.toLowerCase();
    if ((nameLower === "where" || nameLower === "whereby") && args.length === 2 && args[1]!.kind !== "Lambda") {
      const pred = args[1]!;
      return ok({
        kind: "FunctionCall",
        name: "Filter",
        args: [
          args[0]!,
          { kind: "Lambda", params: ["currentValue"], body: pred, span: pred.span },
        ],
        span: span(start, endPos),
      });
    }
    return ok({ kind: "FunctionCall", name, args, span: span(start, endPos) });
  }

  // ---- utilities --------------------------------------------

  private current(): Token {
    return this.tokens[this.pos] ?? { kind: "EOF", raw: "", pos: { line: 1, col: 1, offset: 0 } };
  }

  private peek(ahead = 1): Token | undefined {
    return this.tokens[this.pos + ahead];
  }

  private check(kind: TokenKind): boolean {
    return this.current().kind === kind;
  }

  private advance(): Token {
    const tok = this.current();
    if (!this.isAtEnd()) this.pos++;
    return tok;
  }

  private isAtEnd(): boolean {
    return this.current().kind === "EOF";
  }
}

function span(start: Position, end: Position): Span {
  return { start, end };
}
