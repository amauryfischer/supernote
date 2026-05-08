/**
 * entity-adapter — bridges the Routine UI domain (RoutineFixture) and the
 * generic Entity storage. Routines are stored as entities of type "routine"
 * (see seed-default-types.ts). The trigger, actions, and conditions live as
 * JSON-encoded longtext fields on the entity row.
 *
 * Round-trip rule: every shape produced by `entityToRoutine(entity)` must
 * be re-serializable via `routineFixtureToEntityFields(fixture)` without
 * loss. Unknown fields fall back to safe defaults.
 */

import type { Entity, FieldValue } from "@supernote/ipc";
import type {
  RoutineFixture,
  TemplateKey,
  TriggerConfig,
  ActionConfig,
} from "@/components/routines";

export const ROUTINE_TYPE_ID = "routine";

function parseJSON<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string" || !value.trim()) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function stringField(value: FieldValue | undefined): string {
  return typeof value === "string" ? value : "";
}

function boolField(value: FieldValue | undefined, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (value === "true" || value === "1") return true;
    if (value === "false" || value === "0") return false;
  }
  if (typeof value === "number") return value !== 0;
  return fallback;
}

export function entityToRoutine(entity: Entity): RoutineFixture {
  const f = entity.fields ?? {};
  const trigger = parseJSON<TriggerConfig>(f["trigger"], {
    type: "cron",
    expression: stringField(f["cron"]) || undefined,
  });
  // Ensure the cron expression survives older rows where only `cron` was
  // stored (no `trigger` blob yet).
  if (!trigger.expression && stringField(f["cron"])) {
    trigger.expression = stringField(f["cron"]);
  }
  const actions = parseJSON<ActionConfig[]>(f["actions"], []);
  const templateKey = stringField(f["templateKey"]);
  const conditions = stringField(f["conditions"]);

  return {
    id: entity.id,
    name: stringField(f["name"]) || "Routine sans nom",
    description: stringField(f["description"]),
    enabled: boolField(f["enabled"], true),
    trigger,
    condition: conditions || undefined,
    actions: Array.isArray(actions) ? actions : [],
    runs: [],
    templateKey: templateKey ? (templateKey as TemplateKey) : undefined,
  };
}

export function routineFixtureToEntityFields(
  fixture: RoutineFixture,
): Record<string, FieldValue> {
  return {
    name: fixture.name,
    description: fixture.description ?? "",
    cron: fixture.trigger.expression ?? "",
    actions: JSON.stringify(fixture.actions ?? []),
    enabled: fixture.enabled,
    templateKey: fixture.templateKey ?? "",
    trigger: JSON.stringify(fixture.trigger ?? { type: "cron" }),
    conditions: fixture.condition ?? "",
  };
}
