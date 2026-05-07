// ============================================================
// AST node definitions for the Supernote formula language
// ============================================================

export interface Position {
  readonly line: number;
  readonly col: number;
  readonly offset: number;
}

export interface Span {
  readonly start: Position;
  readonly end: Position;
}

// ------ Literal nodes ----------------------------------------

export interface NumberLiteral {
  readonly kind: "NumberLiteral";
  readonly value: number;
  readonly span: Span;
}

export interface StringLiteral {
  readonly kind: "StringLiteral";
  readonly value: string;
  readonly span: Span;
}

export interface BoolLiteral {
  readonly kind: "BoolLiteral";
  readonly value: boolean;
  readonly span: Span;
}

export interface NullLiteral {
  readonly kind: "NullLiteral";
  readonly span: Span;
}

export type Literal = NumberLiteral | StringLiteral | BoolLiteral | NullLiteral;

// ------ Composite nodes --------------------------------------

export interface Identifier {
  readonly kind: "Identifier";
  readonly name: string;
  readonly span: Span;
}

export interface BinaryOp {
  readonly kind: "BinaryOp";
  readonly op: BinaryOperator;
  readonly left: FormulaAST;
  readonly right: FormulaAST;
  readonly span: Span;
}

export type BinaryOperator =
  | "+" | "-" | "*" | "/" | "%"
  | "==" | "!=" | "<" | "<=" | ">" | ">="
  | "and" | "or";

export interface UnaryOp {
  readonly kind: "UnaryOp";
  readonly op: UnaryOperator;
  readonly operand: FormulaAST;
  readonly span: Span;
}

export type UnaryOperator = "-" | "not";

export interface PropertyAccess {
  readonly kind: "PropertyAccess";
  readonly object: FormulaAST;
  readonly property: string;
  readonly span: Span;
}

export interface FunctionCall {
  readonly kind: "FunctionCall";
  readonly name: string;
  readonly args: FormulaAST[];
  readonly span: Span;
}

export interface Lambda {
  readonly kind: "Lambda";
  readonly params: string[];
  readonly body: FormulaAST;
  readonly span: Span;
}

export interface ListLiteral {
  readonly kind: "ListLiteral";
  readonly elements: FormulaAST[];
  readonly span: Span;
}

export interface Conditional {
  readonly kind: "Conditional";
  readonly condition: FormulaAST;
  readonly consequent: FormulaAST;
  readonly alternate: FormulaAST;
  readonly span: Span;
}

/** @EntityName reference resolved via context */
export interface EntityRef {
  readonly kind: "EntityRef";
  readonly ref: string;
  readonly span: Span;
}

/** [[Note Title]] wikilink resolved via context */
export interface WikiLink {
  readonly kind: "WikiLink";
  readonly title: string;
  readonly span: Span;
}

// ------ Root union -------------------------------------------

export type FormulaAST =
  | Literal
  | Identifier
  | BinaryOp
  | UnaryOp
  | PropertyAccess
  | FunctionCall
  | Lambda
  | ListLiteral
  | Conditional
  | EntityRef
  | WikiLink;
