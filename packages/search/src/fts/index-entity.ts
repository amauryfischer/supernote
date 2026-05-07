import type { Database } from "better-sqlite3";
import type { Entity, EntityType, FieldValue } from "@supernote/core";

/** Extract a displayable title from entity fields and body. */
function extractTitle(entity: Entity, schema: EntityType): string {
  // Try the "name" field first, then any field named "title"
  const nameField = schema.fields.find(
    (f) => f.name === "name" || f.name === "title",
  );
  if (nameField) {
    const val = entity.fields[nameField.name];
    if (typeof val === "string" && val.length > 0) return val;
  }
  // Fallback: first non-empty line of body
  const firstLine = entity.body?.split("\n").find((l) => l.trim().length > 0);
  return firstLine?.slice(0, 200) ?? "";
}

/** Concatenate all text-like field values for full-text indexing. */
function extractFieldText(entity: Entity, schema: EntityType): string {
  const textKinds = new Set([
    "text",
    "longtext",
    "url",
    "email",
    "phone",
    "markdown",
  ]);
  const parts: string[] = [];
  for (const field of schema.fields) {
    if (!textKinds.has(field.kind)) continue;
    const val: FieldValue = entity.fields[field.name];
    if (typeof val === "string" && val.length > 0) parts.push(val);
  }
  return parts.join(" ");
}

/** Upsert an entity into the FTS5 index. */
export function indexEntity(
  db: Database,
  entity: Entity,
  schema: EntityType,
): void {
  const title = extractTitle(entity, schema);
  const body = entity.body ?? "";
  const tags = (entity.tags ?? []).join(" ");
  const fieldText = extractFieldText(entity, schema);

  const existing = db
    .prepare("SELECT entity_id FROM entity_fts WHERE entity_id = ?")
    .get(entity.id);

  if (existing) {
    db.prepare(
      `UPDATE entity_fts
       SET title = ?, body = ?, tags = ?, field_text = ?, type_id = ?
       WHERE entity_id = ?`,
    ).run(title, body, tags, fieldText, entity.typeId, entity.id);
  } else {
    db.prepare(
      `INSERT INTO entity_fts(entity_id, title, body, tags, field_text, type_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(entity.id, title, body, tags, fieldText, entity.typeId);
  }
}

/** Remove an entity from the FTS5 index. */
export function removeFromFts(db: Database, entityId: string): void {
  db.prepare("DELETE FROM entity_fts WHERE entity_id = ?").run(entityId);
}
