// ============================================================
// Condition evaluator — formula-based condition checking
// ============================================================

import type { FormulaContext, Logger } from "../types/index.js";

export type FormulaEvaluator = (expr: string, ctx: FormulaContext) => unknown;

/**
 * Evaluate a condition expression string.
 * Returns true if condition passes, false otherwise.
 * If no evaluator is provided, defaults to true (condition passes).
 */
export function evaluateCondition(
  condition: string | undefined,
  ctx: FormulaContext,
  evaluator: FormulaEvaluator | undefined,
  logger: Logger
): boolean {
  if (!condition) return true;
  if (!evaluator) {
    logger.warn({ condition }, "No formula evaluator provided, condition skipped");
    return true;
  }
  try {
    const result = evaluator(condition, ctx);
    return Boolean(result);
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    logger.error({ condition, error }, "Condition evaluation failed");
    return false;
  }
}
