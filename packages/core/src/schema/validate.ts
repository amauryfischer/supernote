import type { Entity, EntityType, ValidEntity, ValidationError } from "../types/index.js";
import type { Result } from "../result/index.js";
import { ok, err } from "../result/index.js";
import { buildZodSchemaFromEntityType } from "./zod-builder.js";
import { ZodError } from "zod";

/**
 * Validate an entity's fields against its EntityType schema.
 * Returns Result<ValidEntity, ValidationError[]>.
 */
export function validateEntityFields(
  entity: Entity,
  entityType: EntityType,
): Result<ValidEntity, ValidationError[]> {
  const schema = buildZodSchemaFromEntityType(entityType);
  const parsed = schema.safeParse(entity.fields);

  if (parsed.success) {
    return ok({ ...entity, _validated: true } as ValidEntity);
  }

  const errors: ValidationError[] = mapZodErrors(parsed.error);
  return err(errors);
}

function mapZodErrors(zodError: ZodError): ValidationError[] {
  return zodError.issues.map((issue) => ({
    fieldId: issue.path.join(".") || "unknown",
    message: issue.message,
    received: "received" in issue ? issue.received : undefined,
  }));
}
