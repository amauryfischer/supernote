// ============================================================
// Type inference — déduit le type de sortie d'une formule
// depuis son AST. Heuristique : on regarde le nœud racine.
// ============================================================

import type { FormulaAST } from "./ast.js";

export type InferredKind = "text" | "number" | "date" | "bool" | "list" | "entity" | "unknown";

const NUM_FNS = new Set([
  "Sum","Average","Avg","Median","Product","Min","Max","Count","CountIf",
  "Abs","Round","RoundUp","RoundDown","Ceil","Floor","Int","Sign","Pow","Sqrt","Mod",
  "Log","Ln","Exp","Sin","Cos","Tan","PI","E","Random","RandomBetween",
  "Year","Month","Day","Hour","Minute","Second","Weekday","WeekOfYear","Quarter",
  "DateDiff","Length","Len","Find","ToNumber","ParseInt","ParseFloat",
  "Variance","StdDev","Quantile",
]);
const TEXT_FNS = new Set([
  "Concat","Concatenate","Upper","Lower","Proper","Trim","Left","Right","Middle",
  "Substring","Replace","Split","Join","Slugify","RepeatString","ToText",
  "RegexMatch","RegexReplace","Format","WeekdayName","MonthName","ToYearMonth",
]);
const DATE_FNS = new Set([
  "Now","Today","Date","Time","DateAdd","ParseDate","Yesterday","Tomorrow",
  "StartOfMonth","EndOfMonth",
]);
const BOOL_FNS = new Set([
  "And","Or","Not","Contains","StartsWith","EndsWith","In",
  "IsBlank","IsNotBlank","IsNumber","IsText","IsList","IsBoolean","IsDate",
  "True","False","Equal","NotEqual",
]);
const LIST_FNS = new Set([
  "Filter","Where","Map","Sort","Reverse","Unique","GroupBy","Take","Drop",
  "Slice","ListConcat","Sequence","Pluck","MapFlatten","RegexAll",
]);

const PROP_NUM = new Set(["count","length","sum","avg","average","min","max"]);

export function inferOutputKind(ast: FormulaAST): InferredKind {
  switch (ast.kind) {
    case "NumberLiteral": return "number";
    case "StringLiteral": return "text";
    case "BoolLiteral": return "bool";
    case "NullLiteral": return "unknown";
    case "ListLiteral": return "list";
    case "BinaryOp": {
      const op = ast.op;
      if (op === "==" || op === "!=" || op === "<" || op === "<=" || op === ">" || op === ">=" || op === "and" || op === "or") return "bool";
      if (op === "+") {
        const l = inferOutputKind(ast.left);
        const r = inferOutputKind(ast.right);
        return l === "text" || r === "text" ? "text" : "number";
      }
      return "number";
    }
    case "UnaryOp":
      return ast.op === "not" ? "bool" : "number";
    case "Conditional": {
      const c = inferOutputKind(ast.consequent);
      return c !== "unknown" ? c : inferOutputKind(ast.alternate);
    }
    case "FunctionCall": {
      const n = ast.name;
      if (NUM_FNS.has(n)) return "number";
      if (TEXT_FNS.has(n)) return "text";
      if (DATE_FNS.has(n)) return "date";
      if (BOOL_FNS.has(n)) return "bool";
      if (LIST_FNS.has(n)) return "list";
      if (n === "If" || n === "IfElse" || n === "SwitchIf" || n === "SwitchTrue" || n === "Switch" || n === "Coalesce" || n === "IfBlank") {
        for (let i = 1; i < ast.args.length; i += 2) {
          const k = inferOutputKind(ast.args[i]!);
          if (k !== "unknown") return k;
        }
        return "unknown";
      }
      return "unknown";
    }
    case "PropertyAccess":
      if (PROP_NUM.has(ast.property.toLowerCase())) return "number";
      if (ast.property.toLowerCase() === "first" || ast.property.toLowerCase() === "last") return "unknown";
      return "unknown";
    case "Identifier":
    case "EntityRef":
    case "WikiLink":
    case "VariableRef":
    case "Lambda":
      return "unknown";
  }
}

/** Mappe l'inférence vers l'un des outputKind FormulaField. */
export function inferFormulaOutputKind(ast: FormulaAST): "text" | "number" | "date" | "bool" {
  const k = inferOutputKind(ast);
  if (k === "number" || k === "date" || k === "bool") return k;
  return "text";
}
