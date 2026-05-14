// ============================================================
// Evaluator — walks the AST and produces a Value
// ============================================================

import type { FormulaAST } from "./ast.js";
import type { Value, FormulaContext, LambdaValue, Scope } from "./value.js";
import { isLambda, coerceToNumber, coerceToBool, coerceToString } from "./value.js";
import { makeEvalError, type EvalError } from "./errors.js";
import type { Result } from "@supernote/core/result";
import { ok, err } from "@supernote/core/result";
import { mathFunctions } from "./stdlib/math.js";
import { dateFunctions } from "./stdlib/dates.js";
import { stringFunctions } from "./stdlib/strings.js";
import { logicFunctions } from "./stdlib/logic.js";
import { makeListFunctions } from "./stdlib/lists.js";
import { makeEntityFunctions } from "./stdlib/entities.js";

export class Evaluator {
  private readonly listFns: Record<string, (args: Value[]) => Result<Value, EvalError>>;
  private readonly entityFns: Record<string, (args: Value[]) => Result<Value, EvalError>>;

  constructor(
    private readonly ctx: FormulaContext,
  ) {
    this.listFns = makeListFunctions(this.applyLambda.bind(this));
    this.entityFns = makeEntityFunctions(ctx, this.applyLambda.bind(this));
  }

  eval(node: FormulaAST, scope: Scope = {}): Result<Value, EvalError> {
    switch (node.kind) {
      case "NumberLiteral": return ok(node.value);
      case "StringLiteral": return ok(node.value);
      case "BoolLiteral": return ok(node.value);
      case "NullLiteral": return ok(null);

      case "Identifier": return this.evalIdentifier(node.name, scope);
      case "EntityRef": return this.evalEntityRef(node.ref);
      case "WikiLink": return this.evalWikiLink(node.title);
      case "ListLiteral": return this.evalList(node.elements, scope);
      case "Lambda": return ok({ _type: "lambda", params: node.params, body: node.body, closure: scope });
      case "PropertyAccess": return this.evalPropertyAccess(node, scope);
      case "BinaryOp": return this.evalBinaryOp(node, scope);
      case "UnaryOp": return this.evalUnaryOp(node, scope);
      case "FunctionCall": return this.evalFunctionCall(node, scope);
      case "Conditional": return this.evalConditional(node, scope);
    }
  }

  private evalIdentifier(name: string, scope: Scope): Result<Value, EvalError> {
    if (name in scope) return ok(scope[name] ?? null);
    return err(makeEvalError(`Undefined variable '${name}'`, "Identifier"));
  }

  private evalEntityRef(ref: string): Result<Value, EvalError> {
    const entity = this.ctx.resolveEntity(ref);
    if (!entity) return ok(null);
    return ok({ _type: "entity", entity });
  }

  private evalWikiLink(title: string): Result<Value, EvalError> {
    const entity = this.ctx.resolveEntity(title);
    if (!entity) return ok(null);
    return ok({ _type: "entity", entity });
  }

  private evalList(elements: FormulaAST[], scope: Scope): Result<Value, EvalError> {
    const result: Value[] = [];
    for (const el of elements) {
      const r = this.eval(el, scope);
      if (!r.ok) return r;
      result.push(r.value);
    }
    return ok(result);
  }

  private evalPropertyAccess(
    node: { object: FormulaAST; property: string },
    scope: Scope,
  ): Result<Value, EvalError> {
    const obj = this.eval(node.object, scope);
    if (!obj.ok) return obj;
    const val = obj.value;
    if (val === null) return ok(null); // null propagation

    if (typeof val === "object" && !Array.isArray(val) && "_type" in val && (val as { _type: string })._type === "entity") {
      const entity = (val as { _type: "entity"; entity: { fields: Record<string, unknown> } }).entity;
      const fieldVal = entity.fields[node.property];
      return ok(fieldVal !== undefined ? (fieldVal as Value) : null);
    }

    // Coda-style list aggregates as bare properties: `list.count`, `list.sum`...
    if (Array.isArray(val)) {
      const prop = node.property.toLowerCase();
      const nums = val
        .map((v) => (typeof v === "number" ? v : typeof v === "string" ? Number(v) : null))
        .filter((n): n is number => n !== null && !isNaN(n));
      switch (prop) {
        case "count":
        case "length": return ok(val.length);
        case "sum": return ok(nums.reduce((a, b) => a + b, 0));
        case "avg":
        case "average": return ok(nums.length === 0 ? 0 : nums.reduce((a, b) => a + b, 0) / nums.length);
        case "min": return ok(nums.length === 0 ? null : Math.min(...nums));
        case "max": return ok(nums.length === 0 ? null : Math.max(...nums));
        case "first": return ok(val[0] ?? null);
        case "last": return ok(val[val.length - 1] ?? null);
      }
      // For lists of entities, project the property: `Contacts.email` → list of emails.
      const projected: Value[] = [];
      let anyEntity = false;
      for (const item of val) {
        if (item && typeof item === "object" && !Array.isArray(item) && "_type" in item && (item as { _type: string })._type === "entity") {
          anyEntity = true;
          const e = (item as { _type: "entity"; entity: { fields: Record<string, unknown> } }).entity;
          const fv = e.fields[node.property];
          projected.push(fv !== undefined ? (fv as Value) : null);
        }
      }
      if (anyEntity) return ok(projected);
      return err(makeEvalError(`Cannot access property '${node.property}' on list`, "PropertyAccess"));
    }

    return err(makeEvalError(`Cannot access property '${node.property}' on ${typeof val}`, "PropertyAccess"));
  }

  private evalBinaryOp(
    node: { op: string; left: FormulaAST; right: FormulaAST },
    scope: Scope,
  ): Result<Value, EvalError> {
    const left = this.eval(node.left, scope);
    if (!left.ok) return left;
    const right = this.eval(node.right, scope);
    if (!right.ok) return right;
    return this.applyBinaryOp(node.op, left.value, right.value);
  }

  private applyBinaryOp(op: string, lv: Value, rv: Value): Result<Value, EvalError> {
    // Null propagation for arithmetic
    if (op !== "==" && op !== "!=" && op !== "and" && op !== "or") {
      if (lv === null || rv === null) return ok(null);
    }

    switch (op) {
      case "+": {
        // String concatenation if either side is a string
        if (typeof lv === "string" || typeof rv === "string") {
          return ok(coerceToString(lv) + coerceToString(rv));
        }
        const l = coerceToNumber(lv), r = coerceToNumber(rv);
        if (l === null || r === null) return err(makeEvalError("'+' requires numbers or strings"));
        return ok(l + r);
      }
      case "-": return this.arithmeticOp(lv, rv, (a, b) => a - b, "-");
      case "*": return this.arithmeticOp(lv, rv, (a, b) => a * b, "*");
      case "/": {
        const l = coerceToNumber(lv), r = coerceToNumber(rv);
        if (l === null || r === null) return err(makeEvalError("'/' requires numbers"));
        if (r === 0) return err(makeEvalError("Division by zero"));
        return ok(l / r);
      }
      case "%": {
        const l = coerceToNumber(lv), r = coerceToNumber(rv);
        if (l === null || r === null) return err(makeEvalError("'%' requires numbers"));
        if (r === 0) return err(makeEvalError("Modulo by zero"));
        return ok(l % r);
      }
      case "==": return ok(this.equalValues(lv, rv));
      case "!=": return ok(!this.equalValues(lv, rv));
      case "<": return this.compareOp(lv, rv, (a, b) => a < b, "<");
      case "<=": return this.compareOp(lv, rv, (a, b) => a <= b, "<=");
      case ">": return this.compareOp(lv, rv, (a, b) => a > b, ">");
      case ">=": return this.compareOp(lv, rv, (a, b) => a >= b, ">=");
      case "and": return ok(coerceToBool(lv) && coerceToBool(rv));
      case "or": return ok(coerceToBool(lv) || coerceToBool(rv));
      default: return err(makeEvalError(`Unknown operator '${op}'`));
    }
  }

  private arithmeticOp(lv: Value, rv: Value, fn: (a: number, b: number) => number, op: string): Result<Value, EvalError> {
    const l = coerceToNumber(lv), r = coerceToNumber(rv);
    if (l === null || r === null) return err(makeEvalError(`'${op}' requires numbers`));
    return ok(fn(l, r));
  }

  private compareOp(lv: Value, rv: Value, fn: (a: number, b: number) => boolean, op: string): Result<Value, EvalError> {
    const l = coerceToNumber(lv), r = coerceToNumber(rv);
    if (l !== null && r !== null) return ok(fn(l, r));
    // String comparison fallback
    if (typeof lv === "string" && typeof rv === "string") {
      return ok(fn(lv.localeCompare(rv), 0));
    }
    return err(makeEvalError(`'${op}' requires comparable values`));
  }

  private equalValues(a: Value, b: Value): boolean {
    if (a === b) return true;
    if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
    if (Array.isArray(a) && Array.isArray(b)) {
      return a.length === b.length && a.every((v, i) => this.equalValues(v, b[i] ?? null));
    }
    return false;
  }

  private evalUnaryOp(node: { op: string; operand: FormulaAST }, scope: Scope): Result<Value, EvalError> {
    const val = this.eval(node.operand, scope);
    if (!val.ok) return val;
    if (node.op === "-") {
      const n = coerceToNumber(val.value);
      if (n === null) return err(makeEvalError("Unary '-' requires a number"));
      return ok(-n);
    }
    if (node.op === "not") return ok(!coerceToBool(val.value));
    return err(makeEvalError(`Unknown unary op '${node.op}'`));
  }

  private evalFunctionCall(node: { name: string; args: FormulaAST[] }, scope: Scope): Result<Value, EvalError> {
    // Evaluate args (lambdas stay as lambda values)
    const args: Value[] = [];
    for (const argNode of node.args) {
      const r = this.eval(argNode, scope);
      if (!r.ok) return r;
      args.push(r.value);
    }

    const name = node.name;

    // Dispatch: entity fns first (Filter overloads), then lists, math, dates, strings, logic
    if (name in this.entityFns) return (this.entityFns[name]!)(args);
    if (name in this.listFns) return (this.listFns[name]!)(args);
    if (name in mathFunctions) return (mathFunctions[name]!)(args);
    if (name in stringFunctions) return (stringFunctions[name]!)(args);
    if (name in logicFunctions) return (logicFunctions[name]!)(args);

    // Date functions need "now" callback
    const dateFn = dateFunctions[name];
    if (dateFn) return dateFn(args, this.ctx.now.bind(this.ctx));

    // Check scope for user-defined functions
    if (name in scope) {
      const fn = scope[name] ?? null;
      if (isLambda(fn)) return this.applyLambda(fn, args);
    }

    return err(makeEvalError(`Unknown function '${name}'`, "FunctionCall"));
  }

  private evalConditional(node: { condition: FormulaAST; consequent: FormulaAST; alternate: FormulaAST }, scope: Scope): Result<Value, EvalError> {
    const cond = this.eval(node.condition, scope);
    if (!cond.ok) return cond;
    return coerceToBool(cond.value)
      ? this.eval(node.consequent, scope)
      : this.eval(node.alternate, scope);
  }

  applyLambda(fn: LambdaValue, args: Value[]): Result<Value, EvalError> {
    const childScope: Scope = { ...fn.closure };
    fn.params.forEach((p, i) => { childScope[p] = args[i] ?? null; });
    return this.eval(fn.body, childScope);
  }
}

export function evaluate(
  ast: FormulaAST,
  context: FormulaContext,
  scope: Scope = {},
): Result<Value, EvalError> {
  return new Evaluator(context).eval(ast, scope);
}
