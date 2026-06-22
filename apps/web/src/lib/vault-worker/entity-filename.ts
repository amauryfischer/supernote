/**
 * Pure helpers that turn an entity's fields into the *stem* of its on-disk
 * filename, according to its EntityType `fileNamePattern`. Kept dependency-free
 * (and split out of `worker-router.ts`) so it can be unit-tested without the
 * sqlite-wasm / FSA worker machinery.
 *
 * The stem is what makes the file on disk — and therefore the name shown by any
 * folder-sync (Google Drive, iCloud, GitHub) — follow the entity's human title
 * instead of its ULID.
 */

/**
 * Slugify a display value for use in a filename segment. Mirrors the client
 * helper in `components/notes/adapters.ts` so a given title produces the SAME
 * stem on both sides — otherwise the worker would spuriously rename a file the
 * UI just created. Lowercase, strip diacritics, drop non-alphanumerics, spaces
 * → dashes, capped at 80 chars.
 */
export function slugifyName(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 80);
}

/**
 * Resolve a file *stem* (no directory, no `.md`) from an EntityType's
 * `fileNamePattern`.
 *
 * Supported tokens:
 *   {id}                 → the entity id verbatim (last-resort uniqueness)
 *   {date}               → `fields.date` (first 10 chars) else the createdAt day
 *   {slug}               → slugified best title-ish field (name/titre/title/nom)
 *   {name}/{title}/{...} → slugified value of the matching field
 *
 * Empty tokens collapse and surrounding dash debris is trimmed, so
 * `{date}-{title}` with no title yields just the date. Returns "" when the
 * whole pattern resolves empty (the caller decides the fallback).
 */
export function resolveFileNameStem(
  pattern: string,
  fields: Record<string, unknown>,
  id: string,
  createdAtIso: string,
): string {
  const dateField = fields["date"];
  const dateStr =
    typeof dateField === "string" && dateField.length >= 10
      ? dateField.slice(0, 10)
      : typeof createdAtIso === "string"
        ? createdAtIso.slice(0, 10)
        : "";
  let titleish = "";
  for (const k of ["name", "titre", "title", "nom"]) {
    const v = fields[k];
    if (typeof v === "string" && v.length > 0) {
      titleish = v;
      break;
    }
  }
  return pattern
    .replace(/\{(\w+)\}/g, (_m, token: string) => {
      if (token === "id") return id;
      if (token === "date") return dateStr;
      if (token === "slug") return slugifyName(titleish);
      const v = fields[token];
      return v == null ? "" : slugifyName(String(v));
    })
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}
