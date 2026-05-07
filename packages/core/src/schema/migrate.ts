import type { Entity, EntityType, Field, FieldValue } from "../types/index.js";
import { castFieldValue } from "./cast.js";

export interface MigrationProposal {
  /** Fields that could be auto-fixed */
  readonly fixed: Record<string, FieldValue>;
  /** Fields that need manual resolution */
  readonly conflicts: Array<{ fieldName: string; reason: string; currentValue: FieldValue }>;
  /** Fields removed from the new schema */
  readonly dropped: string[];
  /** Fields added in the new schema with their defaults */
  readonly added: string[];
}

/**
 * Compute migration proposals when an entity's EntityType schema changes.
 * Returns the auto-migrated entity and a report of conflicts/drops.
 */
export function migrateEntity(
  entity: Entity,
  fromType: EntityType,
  toType: EntityType,
): { entity: Entity; proposal: MigrationProposal } {
  const fromFieldMap = new Map<string, Field>(fromType.fields.map((f) => [f.name, f]));
  const toFieldMap = new Map<string, Field>(toType.fields.map((f) => [f.name, f]));

  const fixed: Record<string, FieldValue> = {};
  const conflicts: MigrationProposal["conflicts"] = [];
  const dropped: string[] = [];
  const added: string[] = [];

  // Try to carry over / cast existing fields
  for (const [name, field] of toFieldMap) {
    const currentValue = entity.fields[name];
    if (currentValue !== undefined) {
      const cast = castFieldValue(currentValue, field.kind);
      if (cast === null && field.required) {
        conflicts.push({ fieldName: name, reason: "Required field cannot be coerced", currentValue });
      } else {
        fixed[name] = cast;
      }
    } else if (field.defaultValue !== undefined) {
      fixed[name] = field.defaultValue;
      added.push(name);
    } else if (field.required) {
      conflicts.push({ fieldName: name, reason: "Required field missing in migrated entity", currentValue: null });
    } else {
      added.push(name);
    }
  }

  // Detect dropped fields
  for (const name of fromFieldMap.keys()) {
    if (!toFieldMap.has(name)) {
      dropped.push(name);
    }
  }

  const migratedEntity: Entity = {
    ...entity,
    typeId: toType.id,
    fields: fixed,
    updatedAt: new Date(),
  };

  return {
    entity: migratedEntity,
    proposal: { fixed, conflicts, dropped, added },
  };
}
