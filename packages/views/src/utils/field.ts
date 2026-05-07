import type { Entity, EntityType, Field, FieldValue } from "@supernote/core/types";

export function getFieldValue(entity: Entity, fieldId: string): FieldValue {
  return entity.fields[fieldId] ?? null;
}

export function getFieldById(schema: EntityType, fieldId: string): Field | undefined {
  return schema.fields.find((f) => f.id === fieldId);
}

export function formatFieldValue(value: FieldValue): string {
  if (value == null) return "";
  if (value instanceof Date) return value.toLocaleDateString();
  if (Array.isArray(value)) return value.join(", ");
  return String(value);
}

export function getEntityLabel(entity: Entity, schema: EntityType): string {
  const titleField = schema.fields.find(
    (f) => f.kind === "text" && f.name === "title"
  ) ?? schema.fields[0];
  if (!titleField) return entity.id;
  const val = getFieldValue(entity, titleField.id);
  return formatFieldValue(val) || entity.id;
}

export function groupEntities<T extends Entity>(
  entities: T[],
  fieldId: string
): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const entity of entities) {
    const raw = entity.fields[fieldId];
    const key = raw != null ? String(raw) : "__ungrouped__";
    const arr = groups.get(key) ?? [];
    arr.push(entity);
    groups.set(key, arr);
  }
  return groups;
}
