import { router, publicProcedure } from "./trpc.js";
import { notImplemented } from "../errors/index.js";
import { z } from "zod";

export const EvaluateFormulaInput = z.object({
  expression: z.string(),
});

export const EvaluateFormulaOutput = z.object({
  /** JSON-serialised value, or null on error / empty. */
  value: z.string().nullable(),
  error: z.string().nullable(),
});

export const formulasRouter = router({
  /** Evaluate an arbitrary formula expression with the vault context. */
  evaluate: publicProcedure
    .input(EvaluateFormulaInput)
    .output(EvaluateFormulaOutput)
    .query(() => { throw notImplemented("formulas.evaluate"); }),
});

export type FormulasRouter = typeof formulasRouter;
