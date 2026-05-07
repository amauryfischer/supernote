// ============================================================
// Error types with source positions
// ============================================================

import type { Position } from "./ast.js";

export interface ParseError {
  readonly kind: "ParseError";
  readonly message: string;
  readonly position: Position;
  readonly source?: string;
}

export interface EvalError {
  readonly kind: "EvalError";
  readonly message: string;
  readonly node?: string;
}

export function makeParseError(
  message: string,
  position: Position,
  source?: string,
): ParseError {
  return { kind: "ParseError", message, position, source };
}

export function makeEvalError(message: string, node?: string): EvalError {
  return { kind: "EvalError", message, node };
}

export function formatError(err: ParseError | EvalError): string {
  if (err.kind === "ParseError") {
    const loc = `[${err.position.line}:${err.position.col}]`;
    return `ParseError ${loc}: ${err.message}`;
  }
  const node = err.node ? ` (in ${err.node})` : "";
  return `EvalError${node}: ${err.message}`;
}
