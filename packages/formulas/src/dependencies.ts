// ============================================================
// Dependency analysis — walks the AST to find what data a
// formula depends on so callers can schedule incremental recompute
// ============================================================

import type { FormulaAST } from "./ast.js";
import type { Dependency } from "./value.js";

/** Extract all dependencies referenced in an AST */
export function formulaDependencies(ast: FormulaAST): Dependency[] {
  const deps: Dependency[] = [];
  walk(ast, deps);
  // Deduplicate
  const seen = new Set<string>();
  return deps.filter((d) => {
    const key = `${d.kind}:${d.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function walk(node: FormulaAST, deps: Dependency[]): void {
  switch (node.kind) {
    case "NumberLiteral":
    case "StringLiteral":
    case "BoolLiteral":
    case "NullLiteral":
      return;

    case "Identifier":
      return;

    case "EntityRef":
      deps.push({ kind: "entity", id: node.ref });
      return;

    case "WikiLink":
      deps.push({ kind: "entity", id: node.title });
      return;

    case "PropertyAccess":
      walk(node.object, deps);
      return;

    case "BinaryOp":
      walk(node.left, deps);
      walk(node.right, deps);
      return;

    case "UnaryOp":
      walk(node.operand, deps);
      return;

    case "ListLiteral":
      node.elements.forEach((el) => walk(el, deps));
      return;

    case "Lambda":
      walk(node.body, deps);
      return;

    case "Conditional":
      walk(node.condition, deps);
      walk(node.consequent, deps);
      walk(node.alternate, deps);
      return;

    case "FunctionCall": {
      const name = node.name;
      // Time-dependent functions
      if (name === "Now" || name === "Today") {
        deps.push({ kind: "time", id: "wall-clock" });
      }
      // Entity type queries
      if (name === "Filter" && node.args.length >= 1) {
        const first = node.args[0];
        if (first?.kind === "StringLiteral") {
          deps.push({ kind: "entityType", id: first.value });
        }
      }
      node.args.forEach((a) => walk(a, deps));
      return;
    }
  }
}
