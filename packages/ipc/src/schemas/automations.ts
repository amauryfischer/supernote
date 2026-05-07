import { z } from "zod";

// ── Trigger ───────────────────────────────────────────────────────────────────

export const TriggerTypeSchema = z.enum([
  "entity.created",
  "entity.updated",
  "entity.deleted",
  "workflow.transition",
  "cron",
  "alarm",
  "webhook",
  "manual",
]);
export type TriggerType = z.infer<typeof TriggerTypeSchema>;

export const TriggerSchema = z.object({
  type: TriggerTypeSchema,
  /** Entity type filter for entity.* triggers */
  entityTypeId: z.string().optional(),
  /** Cron expression for cron trigger */
  cron: z.string().optional(),
  /** Field name for alarm trigger */
  alarmField: z.string().optional(),
  /** Offset in days for alarm trigger */
  alarmOffsetDays: z.number().int().optional(),
});
export type Trigger = z.infer<typeof TriggerSchema>;

// ── Action ────────────────────────────────────────────────────────────────────

export const ActionTypeSchema = z.enum([
  "create_entity",
  "update_entity",
  "create_relation",
  "send_notification",
  "open_url",
  "run_script",
  "run_llm_prompt",
  "create_inbox_note",
  "create_draft_email",
]);
export type ActionType = z.infer<typeof ActionTypeSchema>;

export const ActionSchema = z.object({
  type: ActionTypeSchema,
  config: z.record(z.string(), z.unknown()),
});
export type Action = z.infer<typeof ActionSchema>;

// ── Automation ────────────────────────────────────────────────────────────────

export const AutomationSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  description: z.string().optional(),
  enabled: z.boolean().default(true),
  trigger: TriggerSchema,
  conditions: z.string().optional(),
  actions: z.array(ActionSchema),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Automation = z.infer<typeof AutomationSchema>;

// ── Routine (sub-type of Automation) ─────────────────────────────────────────

export const RoutineSchema = AutomationSchema.extend({
  /** Human-readable recurrence label, e.g. "Every Monday at 9am" */
  recurrenceLabel: z.string().optional(),
  /** Template key for built-in routine seeds */
  templateKey: z.string().optional(),
});
export type Routine = z.infer<typeof RoutineSchema>;

// ── AutomationRun ─────────────────────────────────────────────────────────────

export const AutomationRunStatusSchema = z.enum(["pending", "running", "success", "error"]);
export type AutomationRunStatus = z.infer<typeof AutomationRunStatusSchema>;

export const AutomationRunSchema = z.object({
  id: z.string(),
  automationId: z.string(),
  status: AutomationRunStatusSchema,
  triggeredAt: z.string().datetime(),
  completedAt: z.string().datetime().optional(),
  durationMs: z.number().int().nonnegative().optional(),
  error: z.string().optional(),
  payload: z.record(z.string(), z.unknown()).optional(),
});
export type AutomationRun = z.infer<typeof AutomationRunSchema>;

// ── Input schemas ─────────────────────────────────────────────────────────────

export const ListAutomationsInput = z.object({
  enabled: z.boolean().optional(),
  triggerType: TriggerTypeSchema.optional(),
});
export type ListAutomationsInput = z.infer<typeof ListAutomationsInput>;

export const GetAutomationInput = z.object({
  id: z.string().min(1),
});
export type GetAutomationInput = z.infer<typeof GetAutomationInput>;

export const CreateAutomationInput = AutomationSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type CreateAutomationInput = z.infer<typeof CreateAutomationInput>;

export const UpdateAutomationInput = AutomationSchema.partial().required({ id: true }).omit({
  createdAt: true,
  updatedAt: true,
});
export type UpdateAutomationInput = z.infer<typeof UpdateAutomationInput>;

export const DeleteAutomationInput = z.object({
  id: z.string().min(1),
});
export type DeleteAutomationInput = z.infer<typeof DeleteAutomationInput>;

export const RunAutomationInput = z.object({
  id: z.string().min(1),
  /** Optional payload to inject as trigger context */
  payload: z.record(z.string(), z.unknown()).optional(),
});
export type RunAutomationInput = z.infer<typeof RunAutomationInput>;

export const GetRunsInput = z.object({
  automationId: z.string().min(1),
  limit: z.number().int().positive().max(500).default(50),
  offset: z.number().int().nonnegative().default(0),
});
export type GetRunsInput = z.infer<typeof GetRunsInput>;

// ── Routine-specific inputs ───────────────────────────────────────────────────

export const ListRoutinesInput = z.object({
  enabled: z.boolean().optional(),
});
export type ListRoutinesInput = z.infer<typeof ListRoutinesInput>;

export const GetRoutineInput = z.object({
  id: z.string().min(1),
});
export type GetRoutineInput = z.infer<typeof GetRoutineInput>;

export const CreateRoutineInput = RoutineSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type CreateRoutineInput = z.infer<typeof CreateRoutineInput>;

export const UpdateRoutineInput = RoutineSchema.partial().required({ id: true }).omit({
  createdAt: true,
  updatedAt: true,
});
export type UpdateRoutineInput = z.infer<typeof UpdateRoutineInput>;

export const DeleteRoutineInput = z.object({
  id: z.string().min(1),
});
export type DeleteRoutineInput = z.infer<typeof DeleteRoutineInput>;

export const GetNextRunsInput = z.object({
  id: z.string().min(1),
  count: z.number().int().positive().max(20).default(5),
});
export type GetNextRunsInput = z.infer<typeof GetNextRunsInput>;

// ── Output schemas ────────────────────────────────────────────────────────────

export const ListAutomationsOutput = z.array(AutomationSchema);
export type ListAutomationsOutput = z.infer<typeof ListAutomationsOutput>;

export const ListRoutinesOutput = z.array(RoutineSchema);
export type ListRoutinesOutput = z.infer<typeof ListRoutinesOutput>;

export const GetRunsOutput = z.object({
  items: z.array(AutomationRunSchema),
  total: z.number().int().nonnegative(),
});
export type GetRunsOutput = z.infer<typeof GetRunsOutput>;

export const GetNextRunsOutput = z.array(z.string().datetime());
export type GetNextRunsOutput = z.infer<typeof GetNextRunsOutput>;
