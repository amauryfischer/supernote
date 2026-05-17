/**
 * automation-adapter — convert a routine entity row into a validated
 * AutomationConfig the engine can register.
 *
 * Input shape comes from `routineFixtureToEntityFields` in
 * apps/web/src/lib/routines/entity-adapter.ts: fields blob carries
 * `trigger` (JSON), `actions` (JSON), `conditions` (string), `enabled`,
 * `name`, `description`, `templateKey`, plus a legacy `cron` fallback.
 */

import type { AutomationConfig, TriggerConfig, ActionConfig } from "@supernote/automations";
import { AutomationConfigSchema } from "@supernote/automations";

export const ROUTINE_TYPE_ID = "routine";

export interface RoutineConfigDiagnostic {
  config: AutomationConfig | null;
  reason?: string;
  issues?: Array<{ path: string; code: string; message: string }>;
}

function parseJSON<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string" || !value.trim()) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function coerceBool(v: unknown, fallback: boolean): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "string") {
    if (v === "true" || v === "1") return true;
    if (v === "false" || v === "0") return false;
  }
  if (typeof v === "number") return v !== 0;
  return fallback;
}

export interface RoutineRow {
  id: string;
  fields: Record<string, unknown>;
}

/**
 * Build an AutomationConfig from a routine entity. Returns null when the
 * row can't yield a valid config (no trigger, no actions, malformed JSON) —
 * engine should skip registration in that case.
 */
export function routineRowToAutomationConfig(
  row: RoutineRow,
): AutomationConfig | null {
  return routineRowToAutomationConfigDetailed(row).config;
}

export function routineRowToAutomationConfigDetailed(
  row: RoutineRow,
): RoutineConfigDiagnostic {
  const f = row.fields ?? {};
  const trigger = parseJSON<TriggerConfig | null>(f["trigger"], null);
  let triggerNormalized = trigger;
  if (!triggerNormalized) {
    const cron = typeof f["cron"] === "string" ? (f["cron"] as string) : "";
    if (cron) triggerNormalized = { type: "cron", expression: cron };
  } else if (triggerNormalized.type === "cron" && !triggerNormalized.expression) {
    const cron = typeof f["cron"] === "string" ? (f["cron"] as string) : "";
    if (cron) triggerNormalized = { ...triggerNormalized, expression: cron };
  }
  if (!triggerNormalized) {
    return { config: null, reason: "trigger absent (ni champ `trigger` ni `cron`)" };
  }

  const actions = parseJSON<ActionConfig[]>(f["actions"], []);
  if (!Array.isArray(actions)) {
    return { config: null, reason: "actions: JSON ne parse pas un tableau" };
  }
  if (actions.length === 0) {
    return { config: null, reason: "actions: tableau vide (min 1 requis)" };
  }

  const candidate = {
    id: row.id,
    kind: "ROUTINE" as const,
    name: typeof f["name"] === "string" && f["name"] ? (f["name"] as string) : "Routine sans nom",
    enabled: coerceBool(f["enabled"], true),
    trigger: triggerNormalized,
    condition: typeof f["conditions"] === "string" && (f["conditions"] as string).trim()
      ? (f["conditions"] as string)
      : undefined,
    actions,
    description: typeof f["description"] === "string" && (f["description"] as string).length > 0
      ? (f["description"] as string)
      : undefined,
  };

  const parsed = AutomationConfigSchema.safeParse(candidate);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => ({
      path: i.path.join("."),
      code: i.code,
      message: i.message,
    }));
    console.warn("[automation-adapter] AutomationConfigSchema rejected routine", {
      id: row.id,
      issues,
    });
    return {
      config: null,
      reason: "Zod validation",
      issues,
    };
  }
  return { config: parsed.data as AutomationConfig };
}
