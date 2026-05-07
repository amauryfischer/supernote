// ============================================================
// @supernote/formulas — public API
// ============================================================

// AST types
export type {
  FormulaAST,
  Literal,
  NumberLiteral,
  StringLiteral,
  BoolLiteral,
  NullLiteral,
  Identifier,
  BinaryOp,
  BinaryOperator,
  UnaryOp,
  UnaryOperator,
  PropertyAccess,
  FunctionCall,
  Lambda,
  ListLiteral,
  Conditional,
  EntityRef,
  WikiLink,
  Position,
  Span,
} from "./ast.js";

// Error types
export type { ParseError, EvalError } from "./errors.js";
export { formatError } from "./errors.js";

// Value types and context
export type {
  Value,
  EntityValue,
  LambdaValue,
  Scope,
  FormulaContext,
  Dependency,
  DependencyKind,
} from "./value.js";

// Main API
export { parseFormula } from "./parser.js";
export { evaluate, Evaluator } from "./evaluator.js";
export { formulaDependencies } from "./dependencies.js";
