import { router, publicProcedure } from "./trpc.js";
import { notImplemented } from "../errors/index.js";
import { z } from "zod";
import {
  ListVariablesOutput,
  GetVariableInput,
  CreateVariableInput,
  UpdateVariableInput,
  DeleteVariableInput,
  EvaluateVariableInput,
  EvaluateVariableOutput,
  VariableSchema,
} from "../schemas/variables.js";

export const variablesRouter = router({
  /** List all variables. */
  list: publicProcedure
    .output(ListVariablesOutput)
    .query(() => { throw notImplemented("variables.list"); }),

  /** Get a single variable by id. */
  get: publicProcedure
    .input(GetVariableInput)
    .output(VariableSchema)
    .query(() => { throw notImplemented("variables.get"); }),

  /** Create a new variable. */
  create: publicProcedure
    .input(CreateVariableInput)
    .output(VariableSchema)
    .mutation(() => { throw notImplemented("variables.create"); }),

  /** Update an existing variable. */
  update: publicProcedure
    .input(UpdateVariableInput)
    .output(VariableSchema)
    .mutation(() => { throw notImplemented("variables.update"); }),

  /** Delete a variable. */
  delete: publicProcedure
    .input(DeleteVariableInput)
    .output(z.object({ id: z.string(), deleted: z.boolean() }))
    .mutation(() => { throw notImplemented("variables.delete"); }),

  /** Evaluate a variable and return its computed value. */
  evaluate: publicProcedure
    .input(EvaluateVariableInput)
    .output(EvaluateVariableOutput)
    .query(() => { throw notImplemented("variables.evaluate"); }),
});

export type VariablesRouter = typeof variablesRouter;
