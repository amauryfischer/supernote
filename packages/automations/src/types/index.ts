// ============================================================
// Automations package — core types and interfaces
// ============================================================

import type { Entity, RelationEdge } from "@supernote/core/types";

// ------ Trigger types ----------------------------------------

export type TriggerType = "cron" | "event" | "alarm" | "webhook";

export interface CronTriggerConfig {
  readonly expression: string;
  readonly timezone?: string;
}

export type DomainEventType =
  | "entity.created"
  | "entity.updated"
  | "entity.deleted"
  | "workflow.transitioned"
  | "relation.created";

export interface EventTriggerConfig {
  readonly eventType: DomainEventType;
  readonly entityTypeId?: string;
}

export interface AlarmTriggerConfig {
  readonly entityTypeId: string;
  readonly dateField: string;
  /** Offset string, e.g. "-1d", "+2h", "0" */
  readonly offset: string;
  readonly timezone?: string;
}

export interface WebhookTriggerConfig {
  readonly path: string;
  readonly method?: "GET" | "POST" | "PUT" | "PATCH";
}

export type TriggerConfig =
  | ({ type: "cron" } & CronTriggerConfig)
  | ({ type: "event" } & EventTriggerConfig)
  | ({ type: "alarm" } & AlarmTriggerConfig)
  | ({ type: "webhook" } & WebhookTriggerConfig);

// ------ Action types -----------------------------------------

export type ActionType =
  | "create-mail-draft"
  | "create-entity"
  | "update-entity"
  | "create-relation"
  | "notify-os"
  | "notify-app"
  | "webhook"
  | "llm-prompt"
  | "run-script"
  | "create-inbox-note";

export interface CreateMailDraftConfig {
  readonly to: string;
  readonly cc?: string;
  readonly bcc?: string;
  readonly subject: string;
  readonly body: string;
  readonly attachments?: string[];
}

export interface CreateEntityConfig {
  readonly typeId: string;
  readonly fields: Record<string, string>;
  readonly tags?: string[];
}

export interface UpdateEntityConfig {
  readonly entityId: string;
  readonly patch: Record<string, string>;
}

export interface CreateRelationConfig {
  readonly sourceId: string;
  readonly targetId: string;
  readonly relationTypeId: string;
  readonly fields?: Record<string, string>;
}

export interface NotifyOsConfig {
  readonly title: string;
  readonly body: string;
  readonly icon?: string;
}

export interface NotifyAppConfig {
  readonly title: string;
  readonly body: string;
  readonly level?: "info" | "warning" | "error";
}

export interface WebhookActionConfig {
  readonly url: string;
  readonly method?: "GET" | "POST" | "PUT" | "PATCH";
  readonly headers?: Record<string, string>;
  readonly body?: string;
}

export interface LlmPromptConfig {
  readonly prompt: string;
  readonly model?: string;
  readonly storeResultAs?: string;
}

export interface RunScriptConfig {
  readonly script: string;
  readonly timeout?: number;
}

export interface CreateInboxNoteConfig {
  readonly title: string;
  readonly body: string;
  readonly tags?: string[];
}

export type ActionConfig =
  | ({ type: "create-mail-draft" } & CreateMailDraftConfig)
  | ({ type: "create-entity" } & CreateEntityConfig)
  | ({ type: "update-entity" } & UpdateEntityConfig)
  | ({ type: "create-relation" } & CreateRelationConfig)
  | ({ type: "notify-os" } & NotifyOsConfig)
  | ({ type: "notify-app" } & NotifyAppConfig)
  | ({ type: "webhook" } & WebhookActionConfig)
  | ({ type: "llm-prompt" } & LlmPromptConfig)
  | ({ type: "run-script" } & RunScriptConfig)
  | ({ type: "create-inbox-note" } & CreateInboxNoteConfig);

// ------ Automation config ------------------------------------

export type AutomationKind = "REACTIVE" | "ROUTINE";

export interface AutomationConfig {
  readonly id: string;
  readonly kind: AutomationKind;
  readonly name: string;
  readonly enabled: boolean;
  readonly trigger: TriggerConfig;
  readonly condition?: string;
  readonly actions: ActionConfig[];
  readonly description?: string;
}

// ------ Domain event -----------------------------------------

export interface DomainEvent {
  readonly type: DomainEventType;
  readonly entityId?: string;
  readonly entityTypeId?: string;
  readonly entity?: Entity;
  readonly previous?: Entity;
  readonly relation?: RelationEdge;
  readonly fromState?: string;
  readonly toState?: string;
  readonly timestamp: Date;
}

// ------ Run results ------------------------------------------

export type RunStatus = "RUNNING" | "SUCCESS" | "FAILURE" | "SKIPPED";

export interface ActionResult {
  readonly actionType: ActionType;
  readonly success: boolean;
  readonly output?: unknown;
  readonly error?: string;
  readonly durationMs: number;
}

export interface AutomationRunResult {
  readonly id: string;
  readonly automationId: string;
  readonly status: RunStatus;
  readonly triggerPayload: unknown;
  readonly actionResults: ActionResult[];
  readonly errorMessage?: string;
  readonly durationMs: number;
  readonly createdAt: Date;
}

export interface NextRun {
  readonly automationId: string;
  readonly automationName: string;
  readonly nextRunAt: Date;
}

// ------ Mail draft -------------------------------------------

export interface MailDraft {
  readonly to: string[];
  readonly cc?: string[];
  readonly bcc?: string[];
  readonly subject: string;
  readonly body: string;
  readonly attachments?: string[];
}

// ------ App notification ------------------------------------

export interface AppNotification {
  readonly title: string;
  readonly body: string;
  readonly level?: "info" | "warning" | "error";
  readonly timestamp: Date;
}

// ------ Formula context -------------------------------------

export type FormulaContext = Record<string, unknown>;

// ------ Logger interface ------------------------------------

export interface Logger {
  info(obj: object | string, msg?: string): void;
  warn(obj: object | string, msg?: string): void;
  error(obj: object | string, msg?: string): void;
  debug(obj: object | string, msg?: string): void;
}

// ------ Engine options ---------------------------------------

export interface EngineResolvers {
  queryEntities: (typeId: string, filter?: Record<string, unknown>) => Promise<Entity[]>;
  getEntity: (id: string) => Promise<Entity | null>;
  createEntity: (typeId: string, fields: Record<string, unknown>, tags?: string[]) => Promise<Entity>;
  updateEntity: (id: string, patch: Record<string, unknown>) => Promise<Entity>;
  deleteEntity: (id: string) => Promise<void>;
  createRelation: (sourceId: string, targetId: string, typeId: string, fields?: Record<string, unknown>) => Promise<RelationEdge>;
  deleteRelation: (id: string) => Promise<void>;
  notify: (notification: AppNotification) => void;
  llmPrompt?: (prompt: string) => Promise<string>;
  httpFetch?: typeof fetch;
  persistRun: (run: AutomationRunResult) => Promise<void>;
  createMailDraft: (draft: MailDraft) => Promise<void>;
}

export interface AutomationEngineOptions {
  readonly formulaContext: FormulaContext;
  readonly resolvers: EngineResolvers;
  readonly logger?: Logger;
  readonly now?: () => Date;
}
