import matter from "gray-matter";
import type { Entity, EntityType, FieldValue } from "../types/index.js";

/** Serialize a FieldValue to a YAML-friendly primitive */
function serializeFieldValue(value: FieldValue): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value;
  return value ?? null;
}

/**
 * Serialize an entity to a full `.md` file string with YAML frontmatter.
 * The frontmatter contains all metadata; the body is the markdown content.
 */
export function serializeEntity(entity: Entity, entityType?: EntityType): string {
  const frontmatter: Record<string, unknown> = {
    id: entity.id,
    type: entityType?.name ?? entity.typeId,
    created: entity.createdAt instanceof Date
      ? entity.createdAt.toISOString()
      : String(entity.createdAt),
    updated: entity.updatedAt instanceof Date
      ? entity.updatedAt.toISOString()
      : String(entity.updatedAt),
    fields: Object.fromEntries(
      Object.entries(entity.fields).map(([k, v]) => [k, serializeFieldValue(v)])
    ),
  };

  if (entity.tags && entity.tags.length > 0) {
    frontmatter["tags"] = entity.tags;
  }

  return matter.stringify(entity.body ?? "", frontmatter);
}
