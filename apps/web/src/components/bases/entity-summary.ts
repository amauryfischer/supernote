/**
 * Helpers for displaying an entity as a compact card (Kanban / Gallery / List).
 *
 * - `deriveCardTitle(entity, base)` → human title (first text-ish field, or
 *   the filename without `.md`, or a placeholder).
 * - `findCoverField(base)` → first field that can act as a cover image
 *   (kind: image, or url with image extension).
 * - `secondaryFields(base, visibleIds)` → ordered fields to show under the
 *   title, skipping the title source so it's not duplicated.
 */

import type { EntityType, Field, FieldKind, FieldValue } from "@supernote/core";

interface MinimalEntity {
  fields: Record<string, unknown>;
  filePath: string;
}

const TITLE_FIELD_NAMES = ["name", "title", "titre", "nom"];

const TITLE_CANDIDATE_KINDS: FieldKind[] = ["text", "longtext", "markdown"];

/**
 * Pick the field that represents the entity's title. Order of preference:
 *   1. A field whose `id` or `name` is one of TITLE_FIELD_NAMES (case-insensitive)
 *   2. The first `text`/`longtext`/`markdown` field declared in the schema
 *   3. null — caller falls back to the filename
 */
export function findTitleField(base: EntityType): Field | null {
  const byName = base.fields.find((f) => {
    const id = (f.id || "").toLowerCase();
    const name = (f.name || "").toLowerCase();
    return TITLE_FIELD_NAMES.some((tn) => id === tn || name === tn || id.endsWith(`_${tn}`));
  });
  if (byName) return byName;
  const byKind = base.fields.find((f) => TITLE_CANDIDATE_KINDS.includes(f.kind));
  return byKind ?? null;
}

export function deriveCardTitle(entity: MinimalEntity, base: EntityType): string {
  const titleField = findTitleField(base);
  if (titleField) {
    const v = entity.fields[titleField.id];
    if (typeof v === "string" && v.trim().length > 0) return v;
  }
  // Fallback to filename without extension and folder prefix
  const stem = entity.filePath.split("/").pop()?.replace(/\.md$/i, "") ?? "";
  return stem || "Sans titre";
}

/** A field is image-cover-able if it's an image kind, or a URL ending in
 * a common image extension. */
export function findCoverField(base: EntityType): Field | null {
  return base.fields.find((f) => f.kind === "image") ?? null;
}

/**
 * Compute the cover image URL for an entity (if any). Returns undefined when
 * the cover field is missing or has no value. Image fields store either a
 * relative path inside the vault or a full URL.
 */
export function readCoverUrl(
  entity: MinimalEntity,
  cover: Field | null,
): string | undefined {
  if (!cover) return undefined;
  const v = entity.fields[cover.id];
  if (typeof v !== "string" || v.length === 0) return undefined;
  return v;
}

/**
 * Fields to display under the title on a card. Skips the title field and
 * the cover, plus any field id explicitly excluded by `skipIds`.
 */
export function secondaryFields(
  base: EntityType,
  options: { skipIds?: string[]; max?: number } = {},
): Field[] {
  const titleField = findTitleField(base);
  const cover = findCoverField(base);
  const skip = new Set(options.skipIds ?? []);
  if (titleField) skip.add(titleField.id);
  if (cover) skip.add(cover.id);
  const candidates = base.fields.filter(
    (f) => !skip.has(f.id) && f.kind !== "longtext" && f.kind !== "markdown",
  );
  return options.max ? candidates.slice(0, options.max) : candidates;
}

/**
 * Field a Kanban view should group by — explicit `groupByField` wins,
 * otherwise pick the first `select` / `status` field of the schema.
 */
export function resolveGroupByField(
  base: EntityType,
  configuredId: string | null | undefined,
): Field | null {
  if (configuredId) {
    const found = base.fields.find((f) => f.id === configuredId);
    if (found) return found;
  }
  return (
    base.fields.find((f) => f.kind === "status") ??
    base.fields.find((f) => f.kind === "select") ??
    null
  );
}

/**
 * Field a Calendar view should anchor entries on. We reuse `groupByField`
 * as the generic "pivot" field — for calendar it means the date column.
 * Explicit value wins; otherwise pick the first `date` / `datetime` field
 * that isn't a system timestamp (createdAt/updatedAt always exist on every
 * type, but most users want to anchor on a domain-specific date).
 */
export function resolveDateField(
  base: EntityType,
  configuredId: string | null | undefined,
): Field | null {
  if (configuredId) {
    const found = base.fields.find((f) => f.id === configuredId);
    if (found) return found;
  }
  const domainDate = base.fields.find(
    (f) => (f.kind === "date" || f.kind === "datetime"),
  );
  if (domainDate) return domainDate;
  return base.fields.find((f) => f.kind === "updatedAt") ?? null;
}

export function readDateValue(
  entity: MinimalEntity,
  dateField: Field,
  createdAt: string,
  updatedAt: string,
): Date | null {
  // `createdAt` / `updatedAt` fields aren't in the entity.fields blob —
  // they come from the entity row's own columns.
  if (dateField.kind === "createdAt") return parseDateSafe(createdAt);
  if (dateField.kind === "updatedAt") return parseDateSafe(updatedAt);
  const v = entity.fields[dateField.id] as FieldValue | undefined;
  if (!v) return null;
  if (v instanceof Date) return v;
  return parseDateSafe(String(v));
}

function parseDateSafe(s: string): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}
