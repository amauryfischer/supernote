/**
 * path-utils — pure helpers for sanitizing and normalizing vault-relative
 * file paths inside the vault web worker.
 *
 * These were previously inlined (and duplicated 10+ times) across
 * `worker-router.ts`: the same `.replace(/\.\./g, "")…` chains and the
 * segment-based folder cleaner. Extracted here so the sanitization invariant
 * lives in one place and is unit-tested independently of the router.
 *
 * Invariant: every helper is a pure string transform — no I/O, no DB, no
 * worker state — so the worker bundle can import it relatively without
 * dragging in any runtime dependency.
 */

/**
 * Strip leading/trailing `/` from a path.
 *
 * `"/Inbox/"` → `"Inbox"`, `"a/b"` → `"a/b"`, `"///"` → `""`.
 *
 * Used on a type's `defaultPath` (which may be authored with a leading
 * slash) before it's prefixed onto a generated filename.
 */
export function stripPathSlashes(path: string): string {
  return path.replace(/^\/+|\/+$/g, "");
}

/**
 * Sanitize a caller-supplied relative file path so it can't escape the vault
 * root. Strips every `..` occurrence, trims leading/trailing slashes, and
 * trims surrounding whitespace.
 *
 * `"  /a/../b/ "` → `"a/b"` (the `..` is removed before slash-stripping, so the
 * intermediate `a//b` collapses to `a/b` once split on `/`… but note this
 * function does NOT collapse interior empty segments — that's preserved
 * verbatim from the original inline implementation to avoid behavior drift).
 *
 * This intentionally mirrors the exact transform that was inlined at the
 * `entitiesCreate`, `entitiesUpdate`, `vault.readFile`, and `vault.writeFile`
 * write paths: `.replace(/\.\./g, "").replace(/^\/+|\/+$/g, "").trim()`.
 */
export function sanitizePath(path: string): string {
  return path
    .replace(/\.\./g, "")
    .replace(/^\/+|\/+$/g, "")
    .trim();
}

/**
 * Sanitize a folder path by dropping empty and `..` segments entirely.
 *
 * `"/Maison/../Inbox//Sub/"` → `"Maison/Inbox/Sub"`.
 *
 * Unlike {@link sanitizePath}, this operates segment-by-segment: it removes
 * empty interior segments (collapsing `//`) and any segment that is exactly
 * `..`. Used by the `folders.*` procedures where the path describes a folder
 * (no `.md` filename) and interior slashes must collapse cleanly.
 */
export function sanitizeFolderPath(path: string): string {
  return path
    .replace(/^\/+|\/+$/g, "")
    .split("/")
    .filter((seg) => seg && seg !== "..")
    .join("/");
}

/**
 * Tokenize a `filePath` (e.g. `Maison VLM/Courses Leroy Merlin/note.md`) into
 * a search-friendly string by stripping `.md`, splitting on `/`, and joining
 * with spaces so FTS5 indexes each path segment as its own term.
 */
export function derivePath(filePath: string | null): string {
  if (!filePath) return "";
  return filePath.replace(/\.md$/i, "").split("/").join(" ");
}
