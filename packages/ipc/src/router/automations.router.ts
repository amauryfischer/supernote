import { router, publicProcedure } from "./trpc.js";
import { notImplemented } from "../errors/index.js";
import {
  ListAutomationsInput,
  ListAutomationsOutput,
  GetAutomationInput,
  AutomationSchema,
  CreateAutomationInput,
  UpdateAutomationInput,
  DeleteAutomationInput,
  RunAutomationInput,
  GetRunsInput,
  GetRunsOutput,
  AutomationRunSchema,
  ListRoutinesInput,
  ListRoutinesOutput,
  GetRoutineInput,
  RoutineSchema,
  CreateRoutineInput,
  UpdateRoutineInput,
  DeleteRoutineInput,
  GetNextRunsInput,
  GetNextRunsOutput,
  RunRoutineInput,
  GetRoutineRunsInput,
  GetRoutineRunsOutput,
  RoutineRunResultSchema,
} from "../schemas/automations.js";
import { z } from "zod";

export const automationsRouter = router({
  /** List all automations (reactive event-driven rules). */
  list: publicProcedure
    .input(ListAutomationsInput)
    .output(ListAutomationsOutput)
    .query(() => {
      throw notImplemented("automations.list");
    }),

  /** Get a single automation by id. */
  get: publicProcedure
    .input(GetAutomationInput)
    .output(AutomationSchema)
    .query(() => {
      throw notImplemented("automations.get");
    }),

  /** Create a new automation rule. */
  create: publicProcedure
    .input(CreateAutomationInput)
    .output(AutomationSchema)
    .mutation(() => {
      throw notImplemented("automations.create");
    }),

  /** Update an existing automation rule. */
  update: publicProcedure
    .input(UpdateAutomationInput)
    .output(AutomationSchema)
    .mutation(() => {
      throw notImplemented("automations.update");
    }),

  /** Delete an automation rule. */
  delete: publicProcedure
    .input(DeleteAutomationInput)
    .output(z.object({ id: z.string(), deleted: z.boolean() }))
    .mutation(() => {
      throw notImplemented("automations.delete");
    }),

  /** Manually trigger an automation with an optional context payload. */
  run: publicProcedure
    .input(RunAutomationInput)
    .output(AutomationRunSchema)
    .mutation(() => {
      throw notImplemented("automations.run");
    }),

  /** Get the execution history of an automation. */
  getRuns: publicProcedure
    .input(GetRunsInput)
    .output(GetRunsOutput)
    .query(() => {
      throw notImplemented("automations.getRuns");
    }),
});

export const routinesRouter = router({
  /** List all routines (proactive user-facing scheduled rules). */
  list: publicProcedure
    .input(ListRoutinesInput)
    .output(ListRoutinesOutput)
    .query(() => {
      throw notImplemented("routines.list");
    }),

  /** Get a single routine by id. */
  get: publicProcedure
    .input(GetRoutineInput)
    .output(RoutineSchema)
    .query(() => {
      throw notImplemented("routines.get");
    }),

  /** Create a new routine. */
  create: publicProcedure
    .input(CreateRoutineInput)
    .output(RoutineSchema)
    .mutation(() => {
      throw notImplemented("routines.create");
    }),

  /** Update an existing routine. */
  update: publicProcedure
    .input(UpdateRoutineInput)
    .output(RoutineSchema)
    .mutation(() => {
      throw notImplemented("routines.update");
    }),

  /** Delete a routine. */
  delete: publicProcedure
    .input(DeleteRoutineInput)
    .output(z.object({ id: z.string(), deleted: z.boolean() }))
    .mutation(() => {
      throw notImplemented("routines.delete");
    }),

  /** Get the next N scheduled execution times for a routine. */
  getNextRuns: publicProcedure
    .input(GetNextRunsInput)
    .output(GetNextRunsOutput)
    .query(() => {
      throw notImplemented("routines.getNextRuns");
    }),

  /** Manually fire a routine through the engine. */
  run: publicProcedure
    .input(RunRoutineInput)
    .output(RoutineRunResultSchema)
    .mutation(() => {
      throw notImplemented("routines.run");
    }),

  /** Fetch persisted run history for a routine (most recent first). */
  getRuns: publicProcedure
    .input(GetRoutineRunsInput)
    .output(GetRoutineRunsOutput)
    .query(() => {
      throw notImplemented("routines.getRuns");
    }),
});

export type AutomationsRouter = typeof automationsRouter;
export type RoutinesRouter = typeof routinesRouter;
