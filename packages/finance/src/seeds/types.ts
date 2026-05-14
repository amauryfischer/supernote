import type { Field, EntityType } from "@supernote/core/types";

/**
 * A seed definition for an EntityType — all data needed to insert a row
 * into the entity_type table. Does not include vaultId (added at runtime).
 * `pluralName` is a convenience alias for `plural` used in the UI.
 */
export interface EntityTypeDefinition
  extends Omit<EntityType, "id" | "validations" | "workflows"> {
  readonly name: string;
  /** Convenience alias matching the spec terminology (same as `plural`) */
  readonly pluralName: string;
  readonly icon: string;
  readonly color: string;
  readonly defaultPath: string;
  readonly fields: Field[];
}
