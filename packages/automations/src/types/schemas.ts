// ============================================================
// Zod schemas for runtime validation of automation configs
// ============================================================

import { z } from "zod";

// ------ Trigger schemas --------------------------------------

export const CronTriggerSchema = z.object({
  type: z.literal("cron"),
  expression: z.string().min(1),
  timezone: z.string().optional(),
});

export const EventTriggerSchema = z.object({
  type: z.literal("event"),
  eventType: z.enum([
    "entity.created",
    "entity.updated",
    "entity.deleted",
    "workflow.transitioned",
    "relation.created",
  ]),
  entityTypeId: z.string().optional(),
});

export const AlarmTriggerSchema = z.object({
  type: z.literal("alarm"),
  entityTypeId: z.string().min(1),
  dateField: z.string().min(1),
  offset: z.string().regex(/^[+-]?\d+[smhdwMy]?$|^0$/, "Invalid offset format"),
  timezone: z.string().optional(),
  recurAnnually: z.boolean().optional(),
});

export const WebhookTriggerSchema = z.object({
  type: z.literal("webhook"),
  path: z.string().min(1),
  method: z.enum(["GET", "POST", "PUT", "PATCH"]).optional(),
});

export const OneShotTriggerSchema = z.object({
  type: z.literal("one-shot"),
  fireAt: z.string().min(1),
  sourceEntityId: z.string().optional(),
});

export const TriggerConfigSchema = z.discriminatedUnion("type", [
  CronTriggerSchema,
  EventTriggerSchema,
  AlarmTriggerSchema,
  WebhookTriggerSchema,
  OneShotTriggerSchema,
]);

// ------ Action schemas ---------------------------------------

export const CreateMailDraftActionSchema = z.object({
  type: z.literal("create-mail-draft"),
  to: z.string().min(1),
  cc: z.string().optional(),
  bcc: z.string().optional(),
  subject: z.string().min(1),
  body: z.string(),
  attachments: z.array(z.string()).optional(),
});

export const CreateEntityActionSchema = z.object({
  type: z.literal("create-entity"),
  typeId: z.string().min(1),
  fields: z.record(z.string()),
  tags: z.array(z.string()).optional(),
});

export const UpdateEntityActionSchema = z.object({
  type: z.literal("update-entity"),
  entityId: z.string().min(1),
  patch: z.record(z.string()),
});

export const CreateRelationActionSchema = z.object({
  type: z.literal("create-relation"),
  sourceId: z.string().min(1),
  targetId: z.string().min(1),
  relationTypeId: z.string().min(1),
  fields: z.record(z.string()).optional(),
});

export const NotifyOsActionSchema = z.object({
  type: z.literal("notify-os"),
  title: z.string().min(1),
  body: z.string(),
  icon: z.string().optional(),
});

export const NotifyAppActionSchema = z.object({
  type: z.literal("notify-app"),
  title: z.string().min(1),
  body: z.string(),
  level: z.enum(["info", "warning", "error"]).optional(),
});

export const WebhookActionSchema = z.object({
  type: z.literal("webhook"),
  url: z.string().url(),
  method: z.enum(["GET", "POST", "PUT", "PATCH"]).optional(),
  headers: z.record(z.string()).optional(),
  body: z.string().optional(),
});

export const LlmPromptActionSchema = z.object({
  type: z.literal("llm-prompt"),
  prompt: z.string().min(1),
  model: z.string().optional(),
  storeResultAs: z.string().optional(),
});

export const RunScriptActionSchema = z.object({
  type: z.literal("run-script"),
  script: z.string().min(1),
  timeout: z.number().int().positive().optional(),
});

export const CreateInboxNoteActionSchema = z.object({
  type: z.literal("create-inbox-note"),
  title: z.string().min(1),
  body: z.string(),
  tags: z.array(z.string()).optional(),
});

export const ActionConfigSchema = z.discriminatedUnion("type", [
  CreateMailDraftActionSchema,
  CreateEntityActionSchema,
  UpdateEntityActionSchema,
  CreateRelationActionSchema,
  NotifyOsActionSchema,
  NotifyAppActionSchema,
  WebhookActionSchema,
  LlmPromptActionSchema,
  RunScriptActionSchema,
  CreateInboxNoteActionSchema,
]);

// ------ Automation config schema -----------------------------

export const AutomationConfigSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(["REACTIVE", "ROUTINE"]),
  name: z.string().min(1),
  enabled: z.boolean(),
  trigger: TriggerConfigSchema,
  condition: z.string().optional(),
  actions: z.array(ActionConfigSchema).min(1),
  description: z.string().optional(),
});

export type ValidatedAutomationConfig = z.infer<typeof AutomationConfigSchema>;
