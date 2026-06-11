/**
 * Tag-path wire encoding shared by the vault worker.
 *
 * Tags are stored one-per-row in `entity_tag`; the SELECTs collapse an entity's
 * tag paths into a single cell with SQLite `GROUP_CONCAT(t.path, char(31))`.
 * char(31) is the ASCII Unit Separator (US, `\x1F`) — a non-printable control
 * char that can never appear inside a user-typed tag path, so splitting on it is
 * safe even when a path contains commas, quotes, slashes, or other punctuation.
 *
 * Both the sync snapshot and the `entities.get` row→API mapping decode through
 * {@link decodeTagPaths} so the separator lives in exactly one place. A previous
 * data-loss bug split on the empty string instead, exploding every multi-segment
 * path (`work/projects/q3`) into individual characters.
 */

/** ASCII Unit Separator used to join tag paths in `GROUP_CONCAT`. */
export const TAG_PATH_SEPARATOR = "\x1F";

/**
 * Decode a `GROUP_CONCAT(path, char(31))` cell back into tag paths.
 *
 * Accepts the raw SQL cell value (`unknown`): NULL when the entity has no tags
 * (the correlated sub-select matched no rows), or a US-joined string otherwise.
 * Empty segments are dropped so a stray leading/trailing separator never yields
 * a phantom `""` tag.
 */
export function decodeTagPaths(raw: unknown): string[] {
  if (typeof raw !== "string" || raw.length === 0) return [];
  return raw.split(TAG_PATH_SEPARATOR).filter(Boolean);
}
