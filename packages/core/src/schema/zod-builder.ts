import { z, ZodTypeAny } from "zod";
import type { EntityType, Field } from "../types/index.js";

/** Build a Zod schema for a single field definition */
function fieldToZod(field: Field): ZodTypeAny {
  let schema: ZodTypeAny;

  switch (field.kind) {
    case "text":
    case "longtext":
    case "url":
    case "email":
    case "phone":
    case "color":
    case "markdown":
      schema = z.string();
      if (field.kind === "email") schema = z.string().email();
      if (field.kind === "url") schema = z.string().url();
      break;

    case "number":
    case "currency":
    case "percent":
    case "rating":
    case "progress":
    case "duration":
    case "autoNumber": {
      let num = z.number();
      if (field.min !== undefined) num = num.min(field.min);
      if (field.max !== undefined) num = num.max(field.max);
      schema = num;
      break;
    }

    case "bool":
      schema = z.boolean();
      break;

    case "date":
    case "datetime":
      schema = z.union([z.date(), z.string().datetime({ offset: true })]);
      break;

    case "select": {
      const vals = field.options.map((o) => o.value) as [string, ...string[]];
      schema = vals.length > 0 ? z.enum(vals) : z.string();
      break;
    }

    case "multiselect": {
      const vals = field.options.map((o) => o.value) as [string, ...string[]];
      const itemSchema = vals.length > 0 ? z.enum(vals) : z.string();
      schema = z.array(itemSchema);
      break;
    }

    case "status": {
      const vals = field.options.map((o) => o.value) as [string, ...string[]];
      schema = vals.length > 0 ? z.enum(vals) : z.string();
      break;
    }

    case "relation":
      // Stored as ULID string reference or array of
      schema = field.cardinality === "many_to_many"
        ? z.array(z.string())
        : z.string();
      break;

    case "file":
    case "image":
      schema = z.string(); // stored as relative path
      break;

    // Computed fields — always optional, readonly
    case "formula":
    case "rollup":
    case "lookup":
    case "createdAt":
    case "updatedAt":
    case "createdBy":
      schema = z.unknown();
      return z.optional(schema);
  }

  if (!field.required) {
    schema = z.optional(schema.nullable());
  }

  return schema;
}

/** Build a full Zod object schema from an EntityType */
export function buildZodSchemaFromEntityType(entityType: EntityType): z.ZodObject<Record<string, ZodTypeAny>> {
  const shape: Record<string, ZodTypeAny> = {};

  for (const field of entityType.fields) {
    shape[field.name] = fieldToZod(field);
  }

  return z.object(shape);
}
