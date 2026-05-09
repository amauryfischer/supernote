/**
 * System folders — paths reserved for typed entities managed by other pages
 * (contacts, todos, finance, …). They must NOT show up in the /notes
 * FileTree (deleting them cascades into all rows under that path, which is
 * why a stray click on "Todos" in /notes wiped the user's todos).
 *
 * Source of truth lives in `vault-worker/seed-default-types.ts` —
 * `DEFAULT_ENTITY_TYPES[].defaultPath`. We mirror only the unique top-level
 * segments here (everything below a root is a descendant we already cover).
 * "Notes" is intentionally excluded: that's the path /notes itself manages.
 */

export const SYSTEM_FOLDER_ROOTS: readonly string[] = [
  "Contacts",
  "Projets",
  "Interactions",
  "Daily",
  "Tags",
  "Finance",
  "Canvas",
  "Routines",
  "Todos",
];

/** True when `path` is a system folder root or anything nested under one. */
export function isSystemFolder(path: string): boolean {
  return SYSTEM_FOLDER_ROOTS.some(
    (root) => path === root || path.startsWith(`${root}/`),
  );
}
