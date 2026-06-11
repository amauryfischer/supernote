/**
 * worker-router — handles tRPC-style route dispatch inside the vault web worker.
 *
 * Implements the same procedure surface as the Electron main process:
 * vault.*, entities.*, schemas.*, tags.*, search.*
 *
 * Drives sqlite-wasm directly (no Prisma) and FSA for file I/O. Full-text
 * search uses the SQLite FTS5 module (shipped by `@sqlite.org/sqlite-wasm`)
 * with manually managed `entity_fts` rows — see `ftsAdd` / `ftsRemove` /
 * `ftsRebuild` below.
 */

import type { Database } from "./sqlite-adapter";
import {
  parseFrontmatter,
  serializeFrontmatter,
  walkAllFiles,
  isMarkdownExt,
  isExcalidrawExt,
  isAttachmentExt,
  writeVaultFile,
  readVaultFile,
  readVaultFileBinary,
  writeVaultFileBinary,
  deleteVaultFile,
  deleteVaultDirectory,
  hashContent,
  generateId,
} from "./fsa-file-io";
import {
  writeExcalidrawSibling,
  readExcalidrawSibling,
  moveExcalidrawSibling,
  deleteExcalidrawSibling,
} from "./canvas-excalidraw-io";
import { parseFormula, evaluate, type FormulaContext, type Value as FormulaValue, type Scope, type FormulaAST } from "@supernote/formulas";
import type { VariableInput } from "@supernote/core";
import { VariableInputSchema } from "@supernote/ipc";
import {
  listVariables,
  getVariable,
  insertVariable,
  updateVariable,
  deleteVariable,
  makeVariableResolver,
  buildVaultFormulaContext,
} from "./variables";
import { resolveMountWrite, crossProvenanceCollision } from "./mount-provenance";

type SqlValue = string | number | null | Uint8Array;
type SqlRow = Record<string, SqlValue>;

interface EntityDoc {
  id: string;
  typeId: string;
  title: string;
  body: string;
  tags: string;
  /**
   * Folder + filename (minus `.md`) of the entity, with `/` replaced by
   * spaces so FTS5 tokenizes each segment. Lets users find a note by
   * any folder along its path — typing "leroy" matches every note in
   * `Maison VLM/Courses Leroy Merlin/...`, even ones whose own title and
   * body never mention the word.
   */
  path: string;
}

function row(res: ReturnType<Database["exec"]>): SqlRow | null {
  if (!res.length || !res[0]) return null;
  const { columns, values } = res[0];
  if (!values.length || !values[0]) return null;
  return Object.fromEntries(columns.map((c, i) => [c, values[0]![i] ?? null]));
}

function rows(res: ReturnType<Database["exec"]>): SqlRow[] {
  if (!res.length || !res[0]) return [];
  const { columns, values } = res[0];
  return values.map((v) => Object.fromEntries(columns.map((c, i) => [c, v[i] ?? null])));
}

function now(): string {
  return new Date().toISOString();
}

// ── FTS5 index helpers ────────────────────────────────────────────────────────

/**
 * Tokenize a `filePath` (e.g. `Maison VLM/Courses Leroy Merlin/note.md`) into
 * a search-friendly string by stripping `.md`, splitting on `/`, and joining
 * with spaces so FTS5 indexes each path segment as its own term.
 */
function derivePath(filePath: string | null): string {
  if (!filePath) return "";
  return filePath.replace(/\.md$/i, "").split("/").join(" ");
}

/**
 * Extract a searchable title from an entity's `fields` JSON.
 *
 * The .md filename is just the entity's random ID, so indexing the filename
 * makes every entity invisible to a name search ("Alice" never matches
 * "<id>.md"). We pull the human-readable name from `fields.name` (with
 * common alternatives) and fall back to the filename only if no name
 * field is present.
 *
 * Aliases (stored as a JSON-encoded string array under `fields.aliases`)
 * are appended to the returned string so FTS5 indexes them under the
 * `title` column — i.e. "@LD" resolves to a contact whose canonical name
 * is "Linh Dan" but who has "LD" listed as an alias.
 */
function deriveTitle(fieldsJson: string | null, filePath: string | null): string {
  let fields: Record<string, unknown> = {};
  if (fieldsJson) {
    try {
      fields = JSON.parse(fieldsJson) as Record<string, unknown>;
    } catch {
      // Malformed JSON — fall through to filename
    }
  }
  let base = "";
  for (const key of ["name", "titre", "title", "nom"]) {
    const v = fields[key];
    if (typeof v === "string" && v.length > 0) { base = v; break; }
  }
  if (!base) {
    base = (filePath ?? "").split("/").pop()?.replace(".md", "") ?? "";
  }
  // Append aliases so MiniSearch matches them under the `title` field.
  // Stored as a JSON-encoded string array (`["LD","Linh"]`); also tolerate a
  // raw array (defensive) and a comma/newline-separated string.
  const aliasesRaw = fields["aliases"];
  const aliases: string[] = (() => {
    if (Array.isArray(aliasesRaw)) {
      return aliasesRaw.filter((a): a is string => typeof a === "string" && a.length > 0);
    }
    if (typeof aliasesRaw === "string" && aliasesRaw.length > 0) {
      const trimmed = aliasesRaw.trim();
      if (trimmed.startsWith("[")) {
        try {
          const parsed = JSON.parse(trimmed) as unknown;
          if (Array.isArray(parsed)) {
            return parsed.filter((a): a is string => typeof a === "string" && a.length > 0);
          }
        } catch {
          // Fall through to the comma/newline split below.
        }
      }
      return trimmed
        .split(/[\n,]/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
    }
    return [];
  })();
  if (aliases.length === 0) return base;
  return base ? `${base} ${aliases.join(" ")}` : aliases.join(" ");
}

/**
 * Build a safe FTS5 MATCH expression from raw user input.
 *
 * FTS5 has its own query syntax (AND OR NOT NEAR, quoted phrases, prefix
 * `*`, column filters with `col:`). Forwarding raw user input would let a
 * stray colon or unbalanced quote throw a syntax error AND would change
 * semantics in surprising ways. We sanitize each whitespace-delimited
 * token, wrap it as a quoted phrase, and append `*` for prefix matching —
 * matching MiniSearch's old `prefix: true` behavior.
 *
 * Fuzzy matching (`fuzzy: 0.2` in the old MiniSearch config) is not
 * supported by FTS5 natively. The prefix glob covers most of what fuzzy
 * was actually used for in practice (typing "lin" to find "Linh").
 *
 * Returns `null` if the query has no usable tokens.
 */
function buildFtsMatch(raw: string): string | null {
  const tokens = raw
    .toLowerCase()
    // Strip FTS5 special characters. Keep letters/digits/underscore — the
    // unicode61 tokenizer with `remove_diacritics 2` does case-folding and
    // diacritic removal at index time, so passing "lea" matches "Léa".
    .split(/\s+/)
    .map((t) => t.replace(/["():\-.\^*¬]/g, ""))
    .filter((t) => t.length > 0);
  if (tokens.length === 0) return null;
  return tokens.map((t) => `"${t}"*`).join(" ");
}

function ftsAdd(db: Database, doc: EntityDoc): void {
  // Defensive: a stale row from a previous indexing pass would lead to
  // duplicate hits in the same query. FTS5 has no UNIQUE constraint on the
  // UNINDEXED `id`, so we explicitly delete-then-insert.
  db.run(`DELETE FROM entity_fts WHERE id = ?`, [doc.id]);
  db.run(
    `INSERT INTO entity_fts (id, title, body, tags, path) VALUES (?, ?, ?, ?, ?)`,
    [doc.id, doc.title, doc.body, doc.tags, doc.path],
  );
}

function ftsRemove(db: Database, id: string): void {
  db.run(`DELETE FROM entity_fts WHERE id = ?`, [id]);
}

/**
 * Rebuild the entity_fts index from scratch for the given vault. Called at
 * router boot when the FTS table is empty (fresh vault, post-migration) and
 * after `vault.reindex` completes so the index reflects the disk truth.
 */
function ftsRebuild(db: Database, vaultId: string): void {
  // `entity_fts` is shared by all vaults in this DB — but in practice the
  // worker only ever sees one vault. Wiping unconditionally keeps the
  // rebuild logic simple and matches the old `initMiniSearch` behavior
  // (which dropped and recreated the in-memory index on every call).
  db.run(`DELETE FROM entity_fts`);
  const allEntities = rows(
    db.exec(
      `SELECT e.id, e.typeId, e.filePath, e.fields, e.body,
              GROUP_CONCAT(t.path, ' ') as tagPaths
       FROM entity e
       LEFT JOIN entity_tag et ON et.entityId = e.id
       LEFT JOIN tag t ON t.id = et.tagId
       WHERE e.vaultId = ?
       GROUP BY e.id`,
      [vaultId],
    ),
  );
  for (const r of allEntities) {
    ftsAdd(db, {
      id: r["id"] as string,
      typeId: r["typeId"] as string,
      title: deriveTitle(r["fields"] as string | null, r["filePath"] as string | null),
      body: (r["body"] as string) ?? "",
      tags: (r["tagPaths"] as string) ?? "",
      path: derivePath(r["filePath"] as string | null),
    });
  }
  console.info(`[search] ftsRebuild indexed ${allEntities.length} entit(y/ies) for vault ${vaultId}`);
}

function entityToDoc(r: SqlRow): EntityDoc {
  return {
    id: r["id"] as string,
    typeId: r["typeId"] as string,
    title: deriveTitle(r["fields"] as string | null, r["filePath"] as string | null),
    body: (r["body"] as string) ?? "",
    tags: (r["tags"] as string) ?? "",
    path: derivePath(r["filePath"] as string | null),
  };
}

// ── Router implementation ─────────────────────────────────────────────────────

export type RouteHandler = (input: unknown) => Promise<unknown>;

export interface RouterLifecycleHooks {
  onEntityCreated?(entity: unknown): void;
  onEntityUpdated?(entity: unknown, previous: unknown): void;
  onEntityDeleted?(id: string, previous: unknown): void;
}

export function buildRouter(
  db: Database,
  vaultHandle: FileSystemDirectoryHandle,
  vaultId: string,
  hooks: RouterLifecycleHooks = {},
): Record<string, RouteHandler> {
  // Populate FTS5 index from `entity` rows. Cheap when empty (post-init),
  // O(n) on already-populated vaults — but the rebuild is just N inserts
  // into FTS5, well under 100ms for a few thousand entities.
  ftsRebuild(db, vaultId);

  // Per-entity write serialization.
  //
  // Background: the worker dispatches each RPC via `void handleRpcRequest(msg)`
  // — handlers run concurrently as independent microtask chains. For mutations
  // on the SAME entity (e.g. canvas saves firing back-to-back as the user
  // draws multiple shapes), two parallel `entitiesUpdate` runs each read
  // the existing row, compute newFields, and `await writeVaultFile` on the
  // SAME `.md` and `.excalidraw` paths. FSA's `createWritable` does NOT take
  // an exclusive lock — concurrent writables write to swap files, and
  // whichever calls `close()` LAST wins. If save1 ([shape1]) finishes after
  // save2 ([shape1, shape2]) the disk ends up with the stale payload and the
  // user sees "second shape lost on refresh".
  //
  // Fix: queue same-entity mutations through a per-id promise chain. Different
  // ids still run in parallel (saving entity A doesn't wait on entity B).
  const entityWriteChains = new Map<string, Promise<unknown>>();
  const runSerialized = <T>(id: string, fn: () => Promise<T>): Promise<T> => {
    const prev = entityWriteChains.get(id) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    // Swallow rejections so a single failed update doesn't poison the chain
    // for every subsequent save on the same entity.
    entityWriteChains.set(
      id,
      next.then(
        () => undefined,
        () => undefined,
      ),
    );
    return next;
  };

  // ── vault.* ────────────────────────────────────────────────────────────────

  const vaultGetCurrent = async (): Promise<unknown> => {
    const r = row(db.exec(`SELECT id, name, rootPath, isActive, createdAt, updatedAt FROM vault WHERE id = ?`, [vaultId]));
    if (!r) return null;
    return {
      id: r["id"],
      name: r["name"],
      path: r["rootPath"],
      isActive: Boolean(r["isActive"]),
      createdAt: r["createdAt"],
      updatedAt: r["updatedAt"],
    };
  };

  const vaultListVaults = async (): Promise<unknown> => {
    return [await vaultGetCurrent()];
  };

  // ── vault.folders.* ────────────────────────────────────────────────────────
  //
  // Folders are persisted as a JSON array under key `notes.folders` in the
  // `setting` table. Two on-disk shapes are accepted on read:
  //   - legacy: ["Inbox", "Projets/2024"]                       (string[])
  //   - new:    [{ path, color?, icon? }, ...]                   (object[])
  // We always write the new object shape — once a vault has been touched
  // it transparently migrates. The list returned by `vault.folders.list`
  // is the union of explicit entries and folder paths derived from
  // `entity.filePath` of existing notes.

  const FOLDERS_SETTING_KEY = "notes.folders";

  // Top-level paths owned by typed entities (todos, contacts, finance, …).
  // Renaming or deleting one cascades into every row whose filePath sits
  // under it, so the user could lose all their todos by clicking "delete"
  // on what looked like a stray "Todos" folder. Keep in sync with
  // `apps/web/src/lib/system-folders.ts` and `seed-default-types.ts`
  // (DEFAULT_ENTITY_TYPES[].defaultPath, minus "Notes").
  const SYSTEM_FOLDER_ROOTS: readonly string[] = [
    "Contacts",
    "Interactions",
    "Daily",
    "Tags",
    "Finance",
    "Canvas",
    "Routines",
    "Todos",
  ];

  function isSystemFolder(p: string): boolean {
    return SYSTEM_FOLDER_ROOTS.some(
      (root) => p === root || p.startsWith(`${root}/`),
    );
  }

  type FolderEntry = { path: string; color?: string; icon?: string; sortOrder?: number };

  function readExplicitFolders(): FolderEntry[] {
    const r = row(db.exec(
      `SELECT value FROM setting WHERE vaultId = ? AND key = ?`,
      [vaultId, FOLDERS_SETTING_KEY],
    ));
    if (!r) return [];
    try {
      const parsed = JSON.parse((r["value"] as string) ?? "[]");
      if (!Array.isArray(parsed)) return [];
      // Tolerate both legacy "string" entries and the new object form.
      // Mixed arrays also work, which matters for vaults migrated
      // partially (e.g. add() ran but no update() yet).
      const out: FolderEntry[] = [];
      for (const item of parsed) {
        if (typeof item === "string" && item.length > 0) {
          out.push({ path: item });
        } else if (
          item &&
          typeof item === "object" &&
          typeof (item as { path?: unknown }).path === "string"
        ) {
          const o = item as { path: string; color?: unknown; icon?: unknown; sortOrder?: unknown };
          const entry: FolderEntry = { path: o.path };
          if (typeof o.color === "string" && o.color) entry.color = o.color;
          if (typeof o.icon === "string" && o.icon) entry.icon = o.icon;
          if (typeof o.sortOrder === "number") entry.sortOrder = o.sortOrder;
          out.push(entry);
        }
      }
      return out;
    } catch {
      // Malformed JSON — treat as empty.
    }
    return [];
  }

  function writeExplicitFolders(entries: FolderEntry[]): void {
    const ts = now();
    // Always serialize in the new object form going forward — this
    // implicitly upgrades any vault that still had a legacy string[]
    // payload the moment we touch it.
    const value = JSON.stringify(entries);
    const existing = row(db.exec(
      `SELECT id FROM setting WHERE vaultId = ? AND key = ?`,
      [vaultId, FOLDERS_SETTING_KEY],
    ));
    if (existing) {
      db.run(
        `UPDATE setting SET value = ?, updatedAt = ? WHERE id = ?`,
        [value, ts, existing["id"] as string],
      );
    } else {
      db.run(
        `INSERT INTO setting (id, vaultId, key, value, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)`,
        [generateId(), vaultId, FOLDERS_SETTING_KEY, value, ts, ts],
      );
    }
  }

  function derivedFolders(): string[] {
    const r = rows(db.exec(
      `SELECT filePath FROM entity WHERE vaultId = ?`, [vaultId],
    ));
    const out = new Set<string>();
    for (const e of r) {
      const fp = (e["filePath"] as string) ?? "";
      const parts = fp.split("/");
      if (parts.length > 1) {
        // Add every ancestor folder (so "a/b/c.md" yields "a" and "a/b").
        for (let i = 1; i < parts.length; i++) {
          out.add(parts.slice(0, i).join("/"));
        }
      } else {
        out.add("Inbox");
      }
    }
    return Array.from(out);
  }

  function sanitizeFolderPath(p: string): string {
    return p
      .replace(/^\/+|\/+$/g, "")
      .split("/")
      .filter((seg) => seg && seg !== "..")
      .join("/");
  }

  /**
   * Merge derived (note-driven) paths with explicit entries, producing the
   * unified object array that the IPC contract returns. The explicit entry
   * wins when both sides reference the same path, so per-folder color/icon
   * survives even when a note also reports the path via its filePath.
   */
  function mergedFolderEntries(): FolderEntry[] {
    const explicit = readExplicitFolders();
    const byPath = new Map<string, FolderEntry>();
    for (const path of derivedFolders()) {
      byPath.set(path, { path });
    }
    for (const entry of explicit) {
      // Explicit entries override derived ones — they may carry color/icon.
      byPath.set(entry.path, entry);
    }
    return Array.from(byPath.values()).sort((a, b) => {
      // When both entries have a sortOrder, use it; otherwise fall back to
      // alphabetical. Entries without sortOrder go after those that have one.
      if (a.sortOrder !== undefined && b.sortOrder !== undefined) {
        return a.sortOrder - b.sortOrder;
      }
      if (a.sortOrder !== undefined) return -1;
      if (b.sortOrder !== undefined) return 1;
      return a.path.localeCompare(b.path);
    });
  }

  const foldersList = async (): Promise<FolderEntry[]> => {
    return mergedFolderEntries();
  };

  const foldersAdd = async (input: unknown): Promise<FolderEntry[]> => {
    const { path } = (input ?? {}) as { path?: string };
    const cleaned = sanitizeFolderPath(path ?? "");
    if (!cleaned) throw new Error("Invalid folder path");
    const explicit = readExplicitFolders();
    if (!explicit.some((e) => e.path === cleaned)) {
      explicit.push({ path: cleaned });
      writeExplicitFolders(explicit);
    }
    return foldersList();
  };

  /**
   * Patch the color / icon of a folder. Creates the explicit entry on the
   * fly if the folder only existed as a derived path (i.e. notes inside it
   * but never explicitly tracked) so the metadata sticks.
   *
   * `color`/`icon` semantics:
   *   - `undefined` → leave the existing value alone
   *   - `null` or empty string → clear the value
   *   - a non-empty string → set it
   */
  const foldersUpdate = async (input: unknown): Promise<FolderEntry[]> => {
    const inp = (input ?? {}) as {
      path?: string;
      color?: string | null;
      icon?: string | null;
      sortOrder?: number | null;
    };
    const cleaned = sanitizeFolderPath(inp.path ?? "");
    if (!cleaned) throw new Error("Invalid folder path");
    const explicit = readExplicitFolders();
    const idx = explicit.findIndex((e) => e.path === cleaned);
    const base: FolderEntry =
      idx >= 0 ? { ...(explicit[idx] as FolderEntry) } : { path: cleaned };

    if (inp.color !== undefined) {
      if (inp.color === null || inp.color === "") delete base.color;
      else base.color = inp.color;
    }
    if (inp.icon !== undefined) {
      if (inp.icon === null || inp.icon === "") delete base.icon;
      else base.icon = inp.icon;
    }
    if (inp.sortOrder !== undefined) {
      if (inp.sortOrder === null) delete base.sortOrder;
      else base.sortOrder = inp.sortOrder;
    }

    if (idx >= 0) explicit[idx] = base;
    else explicit.push(base);
    writeExplicitFolders(explicit);
    return foldersList();
  };

  /**
   * Rename a folder: rewrites every nested .md file at its new path on
   * disk, deletes the originals, then updates the DB rows + the explicit
   * path list to match. Done in this order so that if the disk write fails
   * we never end up with a DB pointing at a missing file.
   */
  const foldersRename = async (input: unknown): Promise<FolderEntry[]> => {
    const { oldPath, newPath } = (input ?? {}) as {
      oldPath?: string;
      newPath?: string;
    };
    const oldCleaned = sanitizeFolderPath(oldPath ?? "");
    const newCleaned = sanitizeFolderPath(newPath ?? "");
    if (!oldCleaned || !newCleaned) throw new Error("Invalid folder path");
    if (oldCleaned === newCleaned) return foldersList();
    if (isSystemFolder(oldCleaned) || isSystemFolder(newCleaned)) {
      throw new Error(`Cannot rename system folder: ${oldCleaned}`);
    }

    // 1. Move every affected .md file to its new location. We re-read the
    //    raw entity row so we can write the same body+frontmatter at the
    //    new path before deleting the old file.
    const affected = rows(db.exec(
      `SELECT id, typeId, filePath, fields, body FROM entity
        WHERE vaultId = ?
          AND (filePath = ? OR filePath LIKE ? || '/%')`,
      [vaultId, oldCleaned, oldCleaned],
    ));

    const ts = now();
    for (const r of affected) {
      const oldFilePath = r["filePath"] as string;
      const newFilePath = newCleaned + oldFilePath.slice(oldCleaned.length);
      const fields = JSON.parse((r["fields"] as string) || "{}") as Record<string, unknown>;
      const typeRow = row(db.exec(
        `SELECT name FROM entity_type WHERE id = ?`,
        [r["typeId"] as string],
      ));
      // See entitiesCreate: top-level keys, no nested `fields:` blob.
      const frontmatter: Record<string, unknown> = {
        id: r["id"],
        type: typeRow?.["name"] ?? "",
        ...fields,
      };
      const content = serializeFrontmatter(frontmatter, (r["body"] as string) ?? "");
      try {
        await writeVaultFile(vaultHandle, newFilePath.split("/"), content);
        await deleteVaultFile(vaultHandle, oldFilePath.split("/"));
      } catch (err) {
        console.warn("[folders.rename] file move failed", oldFilePath, "→", newFilePath, err);
      }
      db.run(
        `UPDATE entity SET filePath = ?, updatedAt = ? WHERE id = ?`,
        [newFilePath, ts, r["id"] as string],
      );
    }

    // 2. Try to drop the now-empty old directory. Best-effort: if there are
    //    leftover non-vault files we just leave them.
    try {
      await deleteVaultDirectory(vaultHandle, oldCleaned.split("/"));
    } catch (err) {
      console.warn("[folders.rename] old dir cleanup failed", oldCleaned, err);
    }

    // 3. Rewrite the explicit-folder list. Map both the path and preserve
    //    any per-folder color/icon — those are tied to the path the user
    //    customized, so renaming the folder must keep them attached.
    const remapped = readExplicitFolders().map((entry) => {
      if (entry.path === oldCleaned || entry.path.startsWith(`${oldCleaned}/`)) {
        return { ...entry, path: newCleaned + entry.path.slice(oldCleaned.length) };
      }
      return entry;
    });
    // Dedupe by path in case a rename collides with an existing entry.
    const seen = new Map<string, FolderEntry>();
    for (const e of remapped) seen.set(e.path, e);
    writeExplicitFolders(Array.from(seen.values()));

    return foldersList();
  };

  /**
   * Cascade-delete a folder: removes every entity whose `filePath` is the
   * folder itself or nested under it (DB row + .md file + search index),
   * drops every explicit folder path that lives under it, then removes the
   * on-disk directory recursively.
   *
   * The previous implementation only removed the explicit-path entry, which
   * meant the folder visually "came back" the next render because notes
   * inside it were still contributing derived paths to the union — and the
   * .md files lingered on disk.
   */
  const foldersDelete = async (input: unknown): Promise<FolderEntry[]> => {
    const { path } = (input ?? {}) as { path?: string };
    const cleaned = sanitizeFolderPath(path ?? "");
    if (!cleaned) throw new Error("Invalid folder path");
    if (isSystemFolder(cleaned)) {
      throw new Error(`Cannot delete system folder: ${cleaned}`);
    }

    // 1. Find every note inside the folder (including all sub-folders).
    const affected = rows(db.exec(
      `SELECT id, filePath FROM entity
        WHERE vaultId = ?
          AND (filePath = ? OR filePath LIKE ? || '/%')`,
      [vaultId, cleaned, cleaned],
    ));

    // 2. Delete each note's .md file, DB row and search-index entry.
    for (const r of affected) {
      const id = r["id"] as string;
      const filePath = r["filePath"] as string;
      try {
        await deleteVaultFile(vaultHandle, filePath.split("/"));
      } catch {
        // File may already be gone; keep going so the DB stays consistent.
      }
      db.run(`DELETE FROM entity WHERE id = ?`, [id]);
      ftsRemove(db, id);
    }

    // 3. Drop the folder + every nested folder from the explicit list.
    const explicit = readExplicitFolders().filter(
      (e) => e.path !== cleaned && !e.path.startsWith(`${cleaned}/`),
    );
    writeExplicitFolders(explicit);

    // 4. Remove the actual directory on disk (recursive, idempotent).
    try {
      await deleteVaultDirectory(vaultHandle, cleaned.split("/"));
    } catch (err) {
      console.warn("[folders.delete] could not remove directory", cleaned, err);
    }

    return foldersList();
  };

  // ── entities.* ─────────────────────────────────────────────────────────────

  const entitiesList = async (input: unknown): Promise<unknown> => {
    const inp = (input ?? {}) as {
      typeId?: string;
      typeName?: string;
      limit?: number;
      offset?: number;
    };
    const limit = inp.limit ?? 50;
    const offset = inp.offset ?? 0;

    // The correlated sub-select pulls every tag path attached to the entity
    // (via entity_tag) and concatenates them with ASCII US (\x1F) so we can
    // safely re-split client-side without colliding with `/`-separated tag
    // paths or any user-typed punctuation. Without this column entityRowToApi
    // returned `tags: []`, so newly added tags vanished after the first
    // navigation away — even though the writes had succeeded.
    let sql = `
      SELECT e.id, e.typeId, et.name as typeName, e.filePath, e.fields, e.body,
             e.createdAt, e.updatedAt,
             (SELECT GROUP_CONCAT(t.path, char(31))
                FROM entity_tag etag
                JOIN tag t ON t.id = etag.tagId
               WHERE etag.entityId = e.id) AS tagPaths
      FROM entity e
      JOIN entity_type et ON et.id = e.typeId
      WHERE e.vaultId = ?
    `;
    const params: SqlValue[] = [vaultId];

    if (inp.typeId) { sql += ` AND e.typeId = ?`; params.push(inp.typeId); }
    if (inp.typeName) { sql += ` AND et.name = ?`; params.push(inp.typeName); }
    sql += ` ORDER BY e.updatedAt DESC LIMIT ? OFFSET ?`;
    params.push(limit, offset);

    const items = rows(db.exec(sql, params)).map(entityRowToApi);
    const total = (row(db.exec(`SELECT COUNT(*) as c FROM entity WHERE vaultId = ?`, [vaultId]))?.[`c`] ?? 0) as number;
    return { items, total };
  };

  // Entités dont createdAt/updatedAt tombe dans [from, to). Utilisé par
  // l'encart "Il y a un an" de l'accueil (et réutilisable : heatmaps, garden).
  const entitiesListByDateRange = async (input: unknown): Promise<unknown> => {
    const inp = (input ?? {}) as {
      from: string;
      to: string;
      field?: "createdAt" | "updatedAt";
      typeName?: string;
      limit?: number;
    };
    // Whitelist du champ trié — jamais interpolé depuis l'input brut.
    const field = inp.field === "updatedAt" ? "updatedAt" : "createdAt";
    const limit = inp.limit ?? 10;
    let sql = `
      SELECT e.id, e.typeId, et.name as typeName, e.filePath, e.fields, e.body,
             e.createdAt, e.updatedAt,
             (SELECT GROUP_CONCAT(t.path, char(31))
                FROM entity_tag etag
                JOIN tag t ON t.id = etag.tagId
               WHERE etag.entityId = e.id) AS tagPaths
      FROM entity e
      JOIN entity_type et ON et.id = e.typeId
      WHERE e.vaultId = ? AND e.${field} >= ? AND e.${field} < ?
    `;
    const params: SqlValue[] = [vaultId, inp.from, inp.to];
    if (inp.typeName) { sql += ` AND et.name = ?`; params.push(inp.typeName); }
    sql += ` ORDER BY e.${field} DESC LIMIT ?`;
    params.push(limit);
    const items = rows(db.exec(sql, params)).map(entityRowToApi);
    return { items, total: items.length };
  };

  const entitiesGet = async (input: unknown): Promise<unknown> => {
    const { id } = input as { id: string };
    const r = row(db.exec(
      `SELECT e.id, e.typeId, et.name as typeName, e.filePath, e.fields, e.body, e.createdAt, e.updatedAt,
              (SELECT GROUP_CONCAT(t.path, char(31))
                 FROM entity_tag etag
                 JOIN tag t ON t.id = etag.tagId
                WHERE etag.entityId = e.id) AS tagPaths
       FROM entity e JOIN entity_type et ON et.id = e.typeId WHERE e.id = ?`,
      [id],
    ));
    if (!r) throw new Error(`Entity not found: ${id}`);
    const api = entityRowToApi(r) as {
      filePath: string;
      typeName: string;
      fields: Record<string, unknown>;
    };
    // Canvas hydration: when the entity references a sibling `.excalidraw`,
    // read it and inject the reconstituted JSON back into `fields.data`
    // (canvas entities) or `fields.canvas` (notes with canvas view) so
    // the UI keeps consuming the same shape as before the split.
    if (typeof api.fields["canvasFile"] === "string") {
      const doc = await readExcalidrawSibling(vaultHandle, api.filePath);
      if (doc) {
        const targetField = api.typeName === "canvas" ? "data" : "canvas";
        api.fields[targetField] = JSON.stringify(doc);
        const elementCount = Array.isArray((doc as { excalidrawElements?: unknown[] }).excalidrawElements)
          ? ((doc as { excalidrawElements: unknown[] }).excalidrawElements).length
          : 0;
        console.info(
          `[canvas-excalidraw] hydrate: read sibling for ${api.filePath} elements=${elementCount}`,
        );
      } else {
        console.warn(
          `[canvas-excalidraw] hydrate: readExcalidrawSibling returned null for ${api.filePath} (canvasFile=${api.fields["canvasFile"]})`,
        );
      }
    }
    return api;
  };

  const entitiesCreate = async (input: unknown): Promise<unknown> => {
    const { typeId, fields, body, tags } = input as {
      typeId: string;
      fields: Record<string, unknown>;
      body?: string;
      tags?: string[];
    };
    const id = generateId();
    const ts = now();
    const typeRow = row(db.exec(`SELECT name, defaultPath, fileNamePattern FROM entity_type WHERE id = ?`, [typeId]));
    if (!typeRow) throw new Error(`EntityType not found: ${typeId}`);

    // Determine file path. Caller can pass `fields.filePath` (already a
    // full relative path like "Inbox/nouvelle-note.md") — that wins over
    // the type's `defaultPath`. We sanitize then strip `fields.filePath`
    // so it's not double-stored in the JSON blob.
    const requestedFullPath = typeof fields["filePath"] === "string"
      ? (fields["filePath"] as string)
          .replace(/\.\./g, "")
          .replace(/^\/+|\/+$/g, "")
          .trim()
      : "";
    let relativePath: string;
    if (requestedFullPath) {
      relativePath = requestedFullPath.endsWith(".md")
        ? requestedFullPath
        : `${requestedFullPath}/${id}.md`;
      delete fields["filePath"];
    } else {
      const fileName = `${id}.md`;
      const dir = ((typeRow["defaultPath"] as string) ?? "").replace(/^\/+|\/+$/g, "");
      relativePath = dir ? `${dir}/${fileName}` : fileName;
    }

    // Suffix on conflict: if a note with the same filePath already exists in
    // this vault, append "-2", "-3", … until we find a free slot. Without this,
    // creating a second "Nouvelle note" in a folder that already has one
    // throws `UNIQUE constraint failed: entity.vaultId, entity.filePath`.
    const existsAt = (p: string): boolean => {
      const r = row(db.exec(
        `SELECT 1 FROM entity WHERE vaultId = ? AND filePath = ? LIMIT 1`,
        [vaultId, p],
      ));
      return !!r;
    };
    if (existsAt(relativePath)) {
      const dotIdx = relativePath.lastIndexOf(".");
      const stem = dotIdx > 0 ? relativePath.slice(0, dotIdx) : relativePath;
      const ext = dotIdx > 0 ? relativePath.slice(dotIdx) : "";
      let suffix = 2;
      let candidate = `${stem}-${suffix}${ext}`;
      while (existsAt(candidate) && suffix < 9999) {
        suffix++;
        candidate = `${stem}-${suffix}${ext}`;
      }
      relativePath = candidate;
    }

    // Canvas split: if fields carry a serialized CanvasDocument (canvas
    // standalone → `data`, notes with canvas view → `canvas`), write it
    // to a sibling `.excalidraw` file and replace the in-frontmatter blob
    // with a `canvasFile` pointer. Entities without a canvas blob are
    // untouched.
    const canvasFieldCreate = extractCanvasField(fields);
    if (canvasFieldCreate) {
      try {
        const doc = parseCanvasJson(canvasFieldCreate.json);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const canvasFile = await writeExcalidrawSibling(vaultHandle, relativePath, doc as any);
        if (canvasFile) {
          delete fields[canvasFieldCreate.fieldName];
          fields["canvasFile"] = canvasFile;
        }
      } catch (err) {
        console.warn("[canvas-excalidraw] create: bridge skipped", err);
      }
    }

    // Frontmatter uses TOP-LEVEL YAML keys for each field (id, type, then
    // each user-defined field) instead of a nested `fields: {...}` JSON
    // blob. The latter forced us through JSON.stringify → naive YAML parse,
    // which dropped/garbled values whenever a field contained a comma,
    // quote, or newline (the symptom: contact name disappearing and the
    // ULID showing up instead, because the reindex re-parsed the file and
    // got an empty `fields` object).
    const frontmatter: Record<string, unknown> = { id, type: typeRow["name"], ...fields };
    const content = serializeFrontmatter(frontmatter, body ?? "");
    await writeVaultFile(vaultHandle, relativePath.split("/"), content);

    db.run(
      `INSERT INTO entity (id, vaultId, typeId, filePath, fields, body, fileHash, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, vaultId, typeId, relativePath, JSON.stringify(fields), body ?? "", "", ts, ts],
    );

    if (tags?.length) {
      await applyEntityTags(db, vaultId, id, tags, ts);
    }

    ftsAdd(db, {
      id,
      typeId,
      title: deriveTitle(JSON.stringify(fields), relativePath),
      body: body ?? "",
      tags: (tags ?? []).join(" "),
      path: derivePath(relativePath),
    });

    const created = await entitiesGet({ id });
    try { hooks.onEntityCreated?.(created); } catch (e) { console.warn("[hook] onEntityCreated", e); }
    return created;
  };

  const entitiesUpdate = async (input: unknown): Promise<unknown> => {
    const { id, fields, body, tags, filePath: rawNextPath } = input as {
      id: string;
      fields?: Record<string, unknown>;
      body?: string;
      tags?: string[];
      filePath?: string;
    };
    return runSerialized(id, async () => {
    const ts = now();
    const existing = row(db.exec(
      `SELECT fields, body, filePath, typeId FROM entity WHERE id = ?`, [id],
    ));
    if (!existing) throw new Error(`Entity not found: ${id}`);
    const previousForHook = await entitiesGet({ id }).catch(() => null);

    // Defensive parse: strips character-index keys from prior corruption
    // and deep-unescapes string values. See safeParseFieldsBlob for details.
    const existingFields = safeParseFieldsBlob((existing["fields"] as string) || "{}");
    const newFields = fields ? { ...existingFields, ...fields } : existingFields;
    const newBody = body ?? (existing["body"] as string) ?? "";

    const oldPath = (existing["filePath"] as string) ?? "";
    // Normalize the requested path: strip ".." segments and leading/trailing
    // slashes so a malicious caller can't escape the vault root.
    const cleanedNextPath =
      typeof rawNextPath === "string"
        ? rawNextPath.replace(/\.\./g, "").replace(/^\/+|\/+$/g, "").trim()
        : "";
    const isMove = cleanedNextPath.length > 0 && cleanedNextPath !== oldPath;
    const effectivePath = isMove ? cleanedNextPath : oldPath;

    // Canvas split on update: mirrors entitiesCreate. If the incoming
    // fields carry a fresh canvas JSON, write it to the sibling and
    // replace with a canvasFile pointer.
    const canvasFieldUpdate = extractCanvasField(newFields);
    if (canvasFieldUpdate) {
      try {
        const doc = parseCanvasJson(canvasFieldUpdate.json);
        const elementCount = Array.isArray((doc as { excalidrawElements?: unknown[] }).excalidrawElements)
          ? ((doc as { excalidrawElements: unknown[] }).excalidrawElements).length
          : 0;
        console.info(
          `[canvas-excalidraw] update: writing sibling for ${effectivePath} elements=${elementCount}`,
        );
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const canvasFile = await writeExcalidrawSibling(vaultHandle, effectivePath, doc as any);
        if (canvasFile) {
          delete newFields[canvasFieldUpdate.fieldName];
          newFields["canvasFile"] = canvasFile;
          console.info(
            `[canvas-excalidraw] update: sibling written ${effectivePath} -> ${canvasFile}`,
          );
        } else {
          console.warn(
            `[canvas-excalidraw] update: writeExcalidrawSibling returned null for ${effectivePath} — canvas left INLINE in .md`,
          );
        }
      } catch (err) {
        console.warn("[canvas-excalidraw] update: bridge skipped", err);
      }
    }

    // Attachment guard: if this entity's filePath points at a non-markdown
    // file (image, pdf, docx, xlsx, csv, gdoc, …) AND carries an
    // `attachmentFile` reference, DON'T overwrite that file with markdown
    // frontmatter — the file is the source of truth and serializing
    // metadata onto it would corrupt the binary content. Persist metadata
    // changes (tags, fields, body) in SQL only. Real edits to attachments
    // go through dedicated paths (viewers / future editors), not through
    // this generic update route.
    const isAttachmentEntity =
      typeof newFields["attachmentFile"] === "string" &&
      !effectivePath.toLowerCase().endsWith(".md") &&
      !effectivePath.toLowerCase().endsWith(".markdown");

    let hash: string | null = null;
    if (!isAttachmentEntity) {
      // Rewrite the .md file
      const typeRow = row(db.exec(`SELECT name FROM entity_type WHERE id = ?`, [existing["typeId"] ?? null]));
      // See entitiesCreate: top-level keys, no nested `fields:` blob.
      const frontmatter: Record<string, unknown> = {
        id,
        type: typeRow?.["name"] ?? "",
        ...newFields,
      };
      const content = serializeFrontmatter(frontmatter, newBody);
      await writeVaultFile(vaultHandle, effectivePath.split("/"), content);
      hash = await hashContent(content);

      if (isMove) {
        // Delete the previous file AFTER writing the new one so a crash mid-
        // move leaves the content reachable at the old path rather than gone.
        try {
          await deleteVaultFile(vaultHandle, oldPath.split("/"));
        } catch {
          // Old file may already be gone (e.g. concurrent move) — best-effort.
        }
        // Move the .excalidraw sibling alongside the .md (best-effort).
        await moveExcalidrawSibling(vaultHandle, oldPath, effectivePath);
      }
    } else if (isMove) {
      // Attachment rename: move the underlying attachment file itself.
      // We don't go through writeVaultFile — that writes markdown.
      console.info(
        `[entitiesUpdate] attachment rename ${oldPath} → ${effectivePath} (binary move not implemented; SQL row updated, disk file left at old path)`,
      );
    }

    db.run(
      `UPDATE entity SET fields = ?, body = ?, fileHash = ?, filePath = ?, updatedAt = ? WHERE id = ?`,
      [JSON.stringify(newFields), newBody, hash, effectivePath, ts, id],
    );

    if (tags !== undefined) {
      db.run(`DELETE FROM entity_tag WHERE entityId = ?`, [id]);
      await applyEntityTags(db, vaultId, id, tags, ts);
    }

    ftsAdd(db, {
      id,
      typeId: existing["typeId"] as string,
      title: deriveTitle(JSON.stringify(newFields), effectivePath),
      body: newBody,
      tags: (tags ?? []).join(" "),
      path: derivePath(effectivePath),
    });

    const updated = await entitiesGet({ id });
    try { hooks.onEntityUpdated?.(updated, previousForHook); } catch (e) { console.warn("[hook] onEntityUpdated", e); }
    return updated;
    });
  };

  const entitiesDelete = async (input: unknown): Promise<unknown> => {
    const { id } = input as { id: string };
    return runSerialized(id, async () => {
    const existing = row(db.exec(`SELECT filePath FROM entity WHERE id = ?`, [id]));
    const previousForHook = existing ? await entitiesGet({ id }).catch(() => null) : null;
    if (existing) {
      const filePath = (existing["filePath"] as string) ?? "";
      try {
        await deleteVaultFile(vaultHandle, filePath.split("/"));
      } catch {
        // File may already be gone
      }
      // Also remove the .excalidraw sibling if present.
      await deleteExcalidrawSibling(vaultHandle, filePath);
      db.run(`DELETE FROM entity WHERE id = ?`, [id]);
      ftsRemove(db, id);
    }
    try { hooks.onEntityDeleted?.(id, previousForHook); } catch (e) { console.warn("[hook] onEntityDeleted", e); }
    return { id, deleted: true };
    });
  };

  /**
   * `entities.search` returns EntitySummary[] (matches the AppRouter type
   * contract). The caller is the inline EntityPicker autocomplete in the
   * editor's slash menu; it expects `{ id, typeId, fields, filePath }` so it
   * can derive a display name from `fields.name`.
   *
   * Distinct from `search.query`, which returns rich SearchResult items
   * (with `excerpts`, `score`, `entityId`) for the global search UI.
   */
  const entitiesSearch = async (input: unknown): Promise<unknown> => {
    const { query, typeId, limit } = input as {
      query: string;
      typeId?: string;
      limit?: number;
    };
    const lim = limit ?? 20;

    // Empty query — return the most recently updated entities of this type so
    // the picker shows something before the user starts typing.
    if (!query.trim()) {
      let listSql = `
        SELECT e.id, e.typeId, et.name as typeName, e.filePath, e.fields, e.body,
               e.createdAt, e.updatedAt
        FROM entity e
        JOIN entity_type et ON et.id = e.typeId
        WHERE e.vaultId = ?
      `;
      const listParams: SqlValue[] = [vaultId];
      if (typeId) { listSql += ` AND e.typeId = ?`; listParams.push(typeId); }
      listSql += ` ORDER BY e.updatedAt DESC LIMIT ?`;
      listParams.push(lim);
      const recent = rows(db.exec(listSql, listParams)).map(entityRowToApi);
      return { items: recent, total: recent.length };
    }

    const match = buildFtsMatch(query);
    if (!match) return { items: [], total: 0 };

    // bm25 weights: title=2 (literal name hit wins), body=1, tags=1, path=1.5
    // (folder-segment match is a strong signal but shouldn't outrank a title
    // hit). Column order in entity_fts: id UNINDEXED is skipped by bm25, so
    // the four weights map to title/body/tags/path respectively.
    let sql = `
      SELECT e.id, e.typeId, et.name as typeName, e.filePath, e.fields, e.body,
             e.createdAt, e.updatedAt
      FROM entity_fts f
      JOIN entity e ON e.id = f.id
      JOIN entity_type et ON et.id = e.typeId
      WHERE f MATCH ? AND e.vaultId = ?
    `;
    const params: SqlValue[] = [match, vaultId];
    if (typeId) { sql += ` AND e.typeId = ?`; params.push(typeId); }
    sql += ` ORDER BY bm25(entity_fts, 2.0, 1.0, 1.0, 1.5) LIMIT ?`;
    params.push(lim);

    let entityRows: SqlRow[];
    try {
      entityRows = rows(db.exec(sql, params));
    } catch (err) {
      // FTS5 syntax errors on edge-case queries (e.g. all-special-char input
      // that slipped past `buildFtsMatch`) shouldn't crash the picker.
      console.warn("[search] entitiesSearch MATCH failed", err);
      return { items: [], total: 0 };
    }
    const items = entityRows.map(entityRowToApi);
    return { items, total: items.length };
  };

  const entitiesGetRelated = async (input: unknown): Promise<unknown> => {
    const { id } = input as { id: string };
    const relRows = rows(db.exec(
      `SELECT e.id, e.typeId, et.name as typeName, e.filePath, e.fields, e.body, e.createdAt, e.updatedAt
       FROM relation_edge re
       JOIN entity e ON e.id = re.targetId
       JOIN entity_type et ON et.id = e.typeId
       WHERE re.sourceId = ?`,
      [id],
    ));
    return { items: relRows.map(entityRowToApi), total: relRows.length };
  };

  const entitiesGetBacklinks = async (input: unknown): Promise<unknown> => {
    const { id } = input as { id: string };
    const mentionRows = rows(db.exec(
      `SELECT sourceId, rawText as context FROM mention WHERE targetId = ?`, [id],
    ));
    return mentionRows.map((r) => ({
      sourceId: r["sourceId"],
      sourceFilePath: "",
      context: r["context"] ?? "",
    }));
  };

  // Nombre de backlinks par entité cible, agrégé en une passe (table mention).
  // Sert la vue Jardin : O(1) au lieu de N appels getBacklinks.
  const entitiesBacklinkCounts = async (): Promise<unknown> => {
    const countRows = rows(db.exec(
      `SELECT targetId, COUNT(*) as c FROM mention
        WHERE targetId IS NOT NULL
        GROUP BY targetId`,
    ));
    const counts: Record<string, number> = {};
    for (const r of countRows) {
      const tid = r["targetId"];
      if (typeof tid === "string") counts[tid] = (r["c"] as number) ?? 0;
    }
    return { counts };
  };

  // ── schemas.* ─────────────────────────────────────────────────────────────

  const schemasList = async (): Promise<unknown> => {
    const schemaRows = rows(db.exec(
      `SELECT id, name, plural, icon, color, fields, isSystem, createdAt, updatedAt
       FROM entity_type WHERE vaultId = ? ORDER BY name ASC`,
      [vaultId],
    ));
    return schemaRows.map((r) => ({
      id: r["id"],
      name: r["name"],
      plural: r["plural"],
      icon: r["icon"] ?? null,
      color: r["color"] ?? null,
      fields: JSON.parse((r["fields"] as string) || "[]"),
      isSystem: Boolean(r["isSystem"]),
      createdAt: r["createdAt"],
      updatedAt: r["updatedAt"],
    }));
  };

  const schemasCreate = async (input: unknown): Promise<unknown> => {
    const { name, plural, icon, color, fields } = input as {
      name: string;
      plural: string;
      icon?: string;
      color?: string;
      fields?: unknown[];
    };
    const id = generateId();
    const ts = now();
    db.run(
      `INSERT INTO entity_type (id, vaultId, name, plural, icon, color, fields, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, vaultId, name, plural, icon ?? null, color ?? null, JSON.stringify(fields ?? []), ts, ts],
    );
    return schemasList().then((list) => (list as unknown[]).find((s: unknown) => (s as { id: string }).id === id));
  };

  const schemasGet = async (input: unknown): Promise<unknown> => {
    const { id } = input as { id: string };
    const found = await schemasList().then((list) =>
      (list as unknown[]).find((s: unknown) => (s as { id: string }).id === id),
    );
    if (!found) throw new Error(`Schema not found: ${id}`);
    return found;
  };

  const schemasUpdate = async (input: unknown): Promise<unknown> => {
    const { id, ...patch } = input as {
      id: string;
      name?: string;
      plural?: string;
      icon?: string;
      color?: string;
      fields?: unknown[];
    };
    const existing = row(db.exec(`SELECT * FROM entity_type WHERE id = ?`, [id]));
    if (!existing) throw new Error(`Schema not found: ${id}`);
    const ts = now();
    db.run(
      `UPDATE entity_type SET name = ?, plural = ?, icon = ?, color = ?, fields = ?, updatedAt = ? WHERE id = ?`,
      [
        patch.name ?? existing["name"] ?? null,
        patch.plural ?? existing["plural"] ?? null,
        patch.icon ?? existing["icon"] ?? null,
        patch.color ?? existing["color"] ?? null,
        JSON.stringify(patch.fields ?? JSON.parse(existing["fields"] as string)),
        ts,
        id,
      ],
    );
    return schemasList().then((list) => (list as unknown[]).find((s: unknown) => (s as { id: string }).id === id));
  };

  const schemasDelete = async (input: unknown): Promise<unknown> => {
    const { id } = input as { id: string };
    db.run(`DELETE FROM entity_type WHERE id = ?`, [id]);
    return { id, deleted: true };
  };

  // ── views.* ───────────────────────────────────────────────────────────────
  //
  // A view is a named, saved projection of a Base (entity_type): filters,
  // sorts, visible fields, kind (table / board / gallery / …). Persisted in
  // the `view` SQLite table. Inline ad-hoc views (BlockNote `databaseView`
  // blocks) live inside the note body, not here.
  //
  // `view.fields` columns are stored as JSON strings (filters/sorts/etc.) and
  // parsed on read, mirroring the same approach used by `entity_type.fields`.

  const safeJson = <T,>(raw: unknown, fallback: T): T => {
    if (raw === null || raw === undefined) return fallback;
    if (typeof raw !== "string") return fallback;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return fallback;
    }
  };

  const viewRowToApi = (r: SqlRow): unknown => {
    const chart = r["chartConfig"];
    const form = r["formConfig"];
    const timeline = r["timelineConfig"];
    return {
      id: r["id"],
      typeId: r["typeId"],
      name: r["name"],
      icon: (r["icon"] as string) ?? undefined,
      kind: (r["kind"] as string) ?? "table",
      filters: safeJson(r["filters"], [] as unknown[]),
      sorts: safeJson(r["sorts"], [] as unknown[]),
      visibleFields: safeJson(r["visibleFields"], [] as string[]),
      hiddenFields: safeJson(r["hiddenFields"], [] as string[]),
      groupByField: (r["groupByField"] as string) ?? undefined,
      rowHeight: (r["rowHeight"] as string) ?? "normal",
      summarize: safeJson(r["summarize"], {} as Record<string, string>),
      conditionalFormats: safeJson(r["conditionalFormats"], [] as unknown[]),
      chartConfig: chart ? safeJson(chart, undefined) : undefined,
      formConfig: form ? safeJson(form, undefined) : undefined,
      timelineConfig: timeline ? safeJson(timeline, undefined) : undefined,
      isSystem: Boolean(r["isSystem"]),
      createdAt: r["createdAt"],
      updatedAt: r["updatedAt"],
    };
  };

  const viewsList = async (input?: unknown): Promise<unknown> => {
    const { typeId } = (input ?? {}) as { typeId?: string };
    let sql = `SELECT * FROM view WHERE vaultId = ?`;
    const params: SqlValue[] = [vaultId];
    if (typeId) {
      sql += ` AND typeId = ?`;
      params.push(typeId);
    }
    sql += ` ORDER BY isSystem DESC, createdAt ASC`;
    return rows(db.exec(sql, params)).map(viewRowToApi);
  };

  const viewsGet = async (input: unknown): Promise<unknown> => {
    const { id } = input as { id: string };
    const r = row(db.exec(`SELECT * FROM view WHERE id = ?`, [id]));
    if (!r) throw new Error(`View not found: ${id}`);
    return viewRowToApi(r);
  };

  const viewsCreate = async (input: unknown): Promise<unknown> => {
    const inp = (input ?? {}) as {
      typeId: string;
      name: string;
      icon?: string;
      kind?: string;
      filters?: unknown[];
      sorts?: unknown[];
      visibleFields?: string[];
      hiddenFields?: string[];
      groupByField?: string;
      rowHeight?: string;
      summarize?: Record<string, string>;
      conditionalFormats?: unknown[];
      chartConfig?: unknown;
      formConfig?: unknown;
      timelineConfig?: unknown;
      isSystem?: boolean;
    };
    const id = generateId();
    const ts = now();
    db.run(
      `INSERT INTO view (
         id, vaultId, typeId, name, icon, kind,
         filters, sorts, visibleFields, hiddenFields,
         groupByField, rowHeight, summarize, conditionalFormats,
         chartConfig, formConfig, timelineConfig, isSystem, createdAt, updatedAt
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        vaultId,
        inp.typeId,
        inp.name,
        inp.icon ?? null,
        inp.kind ?? "table",
        JSON.stringify(inp.filters ?? []),
        JSON.stringify(inp.sorts ?? []),
        JSON.stringify(inp.visibleFields ?? []),
        JSON.stringify(inp.hiddenFields ?? []),
        inp.groupByField ?? null,
        inp.rowHeight ?? "normal",
        JSON.stringify(inp.summarize ?? {}),
        JSON.stringify(inp.conditionalFormats ?? []),
        inp.chartConfig == null ? null : JSON.stringify(inp.chartConfig),
        inp.formConfig == null ? null : JSON.stringify(inp.formConfig),
        inp.timelineConfig == null ? null : JSON.stringify(inp.timelineConfig),
        inp.isSystem ? 1 : 0,
        ts,
        ts,
      ],
    );
    return viewsGet({ id });
  };

  const viewsUpdate = async (input: unknown): Promise<unknown> => {
    const { id, ...patch } = (input ?? {}) as {
      id: string;
      name?: string;
      icon?: string;
      kind?: string;
      filters?: unknown[];
      sorts?: unknown[];
      visibleFields?: string[];
      hiddenFields?: string[];
      groupByField?: string | null;
      rowHeight?: string;
      summarize?: Record<string, string>;
      conditionalFormats?: unknown[];
      chartConfig?: unknown;
      formConfig?: unknown;
      timelineConfig?: unknown;
    };
    const existing = row(db.exec(`SELECT * FROM view WHERE id = ?`, [id]));
    if (!existing) throw new Error(`View not found: ${id}`);
    const ts = now();

    // Each column is either patched or carried over from the existing row.
    // groupByField is special: callers can pass `null` to clear it, which is
    // different from omitting the field (= keep). Same for chartConfig /
    // formConfig: null clears, undefined keeps existing value.
    const next = {
      name: patch.name ?? (existing["name"] as string),
      icon: patch.icon ?? (existing["icon"] as string | null),
      kind: patch.kind ?? (existing["kind"] as string),
      filters: JSON.stringify(
        patch.filters ?? safeJson(existing["filters"], [] as unknown[]),
      ),
      sorts: JSON.stringify(
        patch.sorts ?? safeJson(existing["sorts"], [] as unknown[]),
      ),
      visibleFields: JSON.stringify(
        patch.visibleFields ??
          safeJson(existing["visibleFields"], [] as string[]),
      ),
      hiddenFields: JSON.stringify(
        patch.hiddenFields ??
          safeJson(existing["hiddenFields"], [] as string[]),
      ),
      groupByField:
        patch.groupByField === undefined
          ? (existing["groupByField"] as string | null)
          : patch.groupByField,
      rowHeight: patch.rowHeight ?? (existing["rowHeight"] as string),
      summarize: JSON.stringify(
        patch.summarize ??
          safeJson(existing["summarize"], {} as Record<string, string>),
      ),
      conditionalFormats: JSON.stringify(
        patch.conditionalFormats ??
          safeJson(existing["conditionalFormats"], [] as unknown[]),
      ),
      chartConfig:
        patch.chartConfig === undefined
          ? (existing["chartConfig"] as string | null)
          : patch.chartConfig === null
            ? null
            : JSON.stringify(patch.chartConfig),
      formConfig:
        patch.formConfig === undefined
          ? (existing["formConfig"] as string | null)
          : patch.formConfig === null
            ? null
            : JSON.stringify(patch.formConfig),
      timelineConfig:
        patch.timelineConfig === undefined
          ? (existing["timelineConfig"] as string | null)
          : patch.timelineConfig === null
            ? null
            : JSON.stringify(patch.timelineConfig),
    };

    db.run(
      `UPDATE view SET name = ?, icon = ?, kind = ?, filters = ?, sorts = ?,
         visibleFields = ?, hiddenFields = ?, groupByField = ?, rowHeight = ?,
         summarize = ?, conditionalFormats = ?, chartConfig = ?, formConfig = ?,
         timelineConfig = ?, updatedAt = ? WHERE id = ?`,
      [
        next.name,
        next.icon ?? null,
        next.kind,
        next.filters,
        next.sorts,
        next.visibleFields,
        next.hiddenFields,
        next.groupByField ?? null,
        next.rowHeight,
        next.summarize,
        next.conditionalFormats,
        next.chartConfig ?? null,
        next.formConfig ?? null,
        next.timelineConfig ?? null,
        ts,
        id,
      ],
    );
    return viewsGet({ id });
  };

  const viewsDelete = async (input: unknown): Promise<unknown> => {
    const { id } = input as { id: string };
    // System (default) views are not user-deletable. The user can still
    // tweak filters/sorts/fields, but the default view must stay so the
    // Base page always has something to fall back to.
    const r = row(db.exec(`SELECT isSystem FROM view WHERE id = ?`, [id]));
    if (r && Number(r["isSystem"]) === 1) {
      throw new Error("Cannot delete the default view");
    }
    db.run(`DELETE FROM view WHERE id = ?`, [id]);
    return { id, deleted: true };
  };

  /**
   * Idempotent: returns the default Table view of `typeId`, creating it
   * lazily on first access (`isSystem: true`, name = type's plural label).
   * Called by the Base page so the user always lands somewhere even when
   * no view has been authored yet.
   */
  const viewsEnsureDefault = async (input: unknown): Promise<unknown> => {
    const { typeId } = input as { typeId: string };
    const existing = row(db.exec(
      `SELECT * FROM view WHERE vaultId = ? AND typeId = ? AND isSystem = 1 LIMIT 1`,
      [vaultId, typeId],
    ));
    if (existing) return viewRowToApi(existing);

    const typeRow = row(db.exec(
      `SELECT plural, name FROM entity_type WHERE id = ?`, [typeId],
    ));
    if (!typeRow) throw new Error(`EntityType not found: ${typeId}`);
    const label = (typeRow["plural"] as string) ?? (typeRow["name"] as string);
    return viewsCreate({
      typeId,
      name: `Toutes les ${label.toLowerCase()}`,
      kind: "table",
      isSystem: true,
    });
  };

  // ── views.queryForView ────────────────────────────────────────────────────
  //
  // Returns entities of `typeId` matching `filters` and ordered by `sorts`.
  // Filters/sorts run in-memory because entity field values are stored in a
  // single JSON blob — pushing them into SQL would require either a JSON
  // function (SQLite ≥3.38, not guaranteed on sql.js standard build) or a
  // normalized side table. For vaults under ~5k entities this is fast enough;
  // we'll optimize when we hit a real perf wall.

  type AnyVal = unknown;

  function compareValues(a: AnyVal, b: AnyVal): number {
    if (a === b) return 0;
    if (a === null || a === undefined) return -1;
    if (b === null || b === undefined) return 1;
    if (typeof a === "number" && typeof b === "number") return a - b;
    // Lowercase string compare so "alice" < "Bob" doesn't flip on case.
    const as = String(a).toLowerCase();
    const bs = String(b).toLowerCase();
    if (as < bs) return -1;
    if (as > bs) return 1;
    return 0;
  }

  function matchesFilter(
    fieldValue: AnyVal,
    op: string,
    target: AnyVal,
  ): boolean {
    switch (op) {
      case "is_empty":
        return (
          fieldValue === null ||
          fieldValue === undefined ||
          fieldValue === "" ||
          (Array.isArray(fieldValue) && fieldValue.length === 0)
        );
      case "is_not_empty":
        return !matchesFilter(fieldValue, "is_empty", target);
      case "eq":
        return String(fieldValue ?? "") === String(target ?? "");
      case "neq":
        return String(fieldValue ?? "") !== String(target ?? "");
      case "contains":
        return String(fieldValue ?? "")
          .toLowerCase()
          .includes(String(target ?? "").toLowerCase());
      case "not_contains":
        return !String(fieldValue ?? "")
          .toLowerCase()
          .includes(String(target ?? "").toLowerCase());
      case "starts_with":
        return String(fieldValue ?? "")
          .toLowerCase()
          .startsWith(String(target ?? "").toLowerCase());
      case "ends_with":
        return String(fieldValue ?? "")
          .toLowerCase()
          .endsWith(String(target ?? "").toLowerCase());
      case "gt":
        return compareValues(fieldValue, target) > 0;
      case "lt":
        return compareValues(fieldValue, target) < 0;
      case "gte":
        return compareValues(fieldValue, target) >= 0;
      case "lte":
        return compareValues(fieldValue, target) <= 0;
      case "in":
        return Array.isArray(target) && target.some((t) => String(fieldValue) === String(t));
      case "not_in":
        return !(Array.isArray(target) && target.some((t) => String(fieldValue) === String(t)));
      default:
        return true;
    }
  }

  const viewsQueryForView = async (input: unknown): Promise<unknown> => {
    const inp = (input ?? {}) as {
      typeId: string;
      filters?: { fieldId: string; op: string; value?: unknown }[];
      sorts?: { fieldId: string; direction: "asc" | "desc" }[];
      limit?: number;
      offset?: number;
    };
    const filters = inp.filters ?? [];
    const sorts = inp.sorts ?? [];
    const limit = inp.limit ?? 1000;
    const offset = inp.offset ?? 0;

    const allRows = rows(db.exec(
      `SELECT e.id, e.typeId, et.name as typeName, e.filePath, e.fields, e.body,
              e.createdAt, e.updatedAt,
              (SELECT GROUP_CONCAT(t.path, char(31))
                 FROM entity_tag etag
                 JOIN tag t ON t.id = etag.tagId
                WHERE etag.entityId = e.id) AS tagPaths
       FROM entity e
       JOIN entity_type et ON et.id = e.typeId
       WHERE e.vaultId = ? AND e.typeId = ?
       ORDER BY e.createdAt ASC, e.id ASC`,
      [vaultId, inp.typeId],
    )).map(entityRowToApi) as Array<{
      id: string;
      typeId: string;
      filePath: string;
      fields: Record<string, unknown>;
      createdAt: string;
      updatedAt: string;
    }>;

    // ── Derived-field enrichment (formula / rollup / lookup) ──────────────
    //
    // For formula: evaluate an expression with {fieldId} placeholders
    // substituted by actual values, using a sandboxed Function constructor.
    // For rollup/lookup: fetch all related entities in one batched SQL query,
    // then distribute results — no per-entity round trips.

    type DerivedFieldDef = {
      id: string;
      name: string;
      kind: string;
      expression?: string;
      outputKind?: string;
      relationFieldId?: string;
      targetFieldId?: string;
      aggregation?: string;
      targetTypeId?: string;
      cardinality?: 'one' | 'many';
    };

    const typeRow = rows(db.exec(
      `SELECT fields FROM entity_type WHERE id = ? AND vaultId = ?`,
      [inp.typeId, vaultId],
    ))[0];

    type RawFieldDef = {
      id: string;
      name: string;
      kind?: string;
      type?: string;
      expression?: string;
      formulaExpr?: string;
      outputKind?: string;
      formulaOutputKind?: string;
      relationFieldId?: string;
      targetFieldId?: string;
      aggregation?: string;
      targetTypeId?: string;
      cardinality?: string;
    };

    // Normalise les 2 shapes possibles (core `kind`/`expression` ou
    // IPC `type`/`formulaExpr`) en un seul `DerivedFieldDef` interne.
    const allFieldDefs: DerivedFieldDef[] = typeRow
      ? (JSON.parse((typeRow["fields"] as string) || "[]") as RawFieldDef[]).map((f): DerivedFieldDef => {
          const rawCard = f.cardinality ?? '';
          const cardinality: 'one' | 'many' =
            rawCard === 'one_to_one' ? 'one' :
            rawCard === 'one_to_many' || rawCard === 'many_to_many' ? 'many' :
            'one';
          return {
            id: f.id,
            name: f.name,
            kind: (f.kind ?? f.type ?? "") as string,
            expression: f.expression ?? f.formulaExpr,
            outputKind: f.outputKind ?? f.formulaOutputKind,
            relationFieldId: f.relationFieldId,
            targetFieldId: f.targetFieldId,
            aggregation: f.aggregation,
            targetTypeId: f.targetTypeId,
            cardinality,
          };
        })
      : [];

    const derivedDefs = allFieldDefs.filter(
      (f) => f.kind === "formula" || f.kind === "rollup" || f.kind === "lookup",
    );

    // ── Cross-base scope ──────────────────────────────────────────────────
    // Collect base names referenced in formula expressions so we can expose
    // them as identifiers (Contact, Tasks, …) bound to lists of entities.
    type BaseInfo = { id: string; name: string; plural: string | null; fields: DerivedFieldDef[] };
    const formulaSources = derivedDefs
      .filter((d) => d.kind === "formula" && d.expression)
      .map((d) => d.expression as string);

    const baseInfos = formulaSources.length > 0
      ? rows(db.exec(
          `SELECT id, name, plural, fields FROM entity_type WHERE vaultId = ?`,
          [vaultId],
        )).map((r): BaseInfo => ({
          id: r["id"] as string,
          name: (r["name"] as string) ?? "",
          plural: (r["plural"] as string | null) ?? null,
          fields: (() => {
            try {
              const raw = JSON.parse((r["fields"] as string) || "[]") as RawFieldDef[];
              return raw.map((f): DerivedFieldDef => {
                const rawCard = f.cardinality ?? '';
                const cardinality: 'one' | 'many' =
                  rawCard === 'one_to_one' ? 'one' :
                  rawCard === 'one_to_many' || rawCard === 'many_to_many' ? 'many' :
                  'one';
                return {
                  id: f.id,
                  name: f.name,
                  kind: (f.kind ?? f.type ?? "") as string,
                  expression: f.expression ?? f.formulaExpr,
                  outputKind: f.outputKind ?? f.formulaOutputKind,
                  relationFieldId: f.relationFieldId,
                  targetFieldId: f.targetFieldId,
                  aggregation: f.aggregation,
                  targetTypeId: f.targetTypeId,
                  cardinality,
                };
              });
            } catch { return []; }
          })(),
        }))
      : [];

    function safeIdent(s: string): string {
      return "_f_" + s.replace(/[^A-Za-z0-9_]/g, "_");
    }

    function baseIdentifiers(b: BaseInfo): string[] {
      const out = new Set<string>();
      const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
      for (const cand of [b.name, b.plural ?? ""]) {
        if (!cand) continue;
        const variants = [cand, cand.toLowerCase(), cap(cand.toLowerCase())];
        for (const v of variants) {
          if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(v)) out.add(v);
          out.add(safeIdent(v));
        }
      }
      return Array.from(out);
    }

    // Identify which bases are referenced. Cheap textual scan — false
    // positives just load extra rows, never break eval.
    const referencedBaseIds = new Set<string>();
    if (baseInfos.length > 0 && formulaSources.length > 0) {
      const joinedSrc = formulaSources.join("\n");
      for (const b of baseInfos) {
        const idents = baseIdentifiers(b);
        if (idents.some((i) => new RegExp(`\\b${i}\\b`, "i").test(joinedSrc))) {
          referencedBaseIds.add(b.id);
        }
      }
    }

    // Batch-load entities for each referenced base.
    const baseEntities = new Map<string, Array<{ id: string; fields: Record<string, unknown>; typeId: string }>>();
    if (referencedBaseIds.size > 0) {
      const ids = Array.from(referencedBaseIds);
      const ph = ids.map(() => "?").join(",");
      const ents = rows(db.exec(
        `SELECT id, typeId, fields FROM entity WHERE vaultId = ? AND typeId IN (${ph})`,
        [vaultId, ...ids],
      ));
      for (const r of ents) {
        const tid = r["typeId"] as string;
        const list = baseEntities.get(tid) ?? [];
        try {
          list.push({
            id: r["id"] as string,
            typeId: tid,
            fields: JSON.parse((r["fields"] as string) || "{}") as Record<string, unknown>,
          });
        } catch { /* skip malformed */ }
        baseEntities.set(tid, list);
      }
    }

    function getRelIds(entityFields: Record<string, unknown>, relFieldId: string): string[] {
      const v = entityFields[relFieldId];
      if (!v) return [];
      if (Array.isArray(v)) return v.map(String).filter(Boolean);
      if (typeof v === "string") {
        if (v.startsWith("[")) {
          try { return (JSON.parse(v) as unknown[]).map(String).filter(Boolean); } catch { /* fall through */ }
        }
        return v ? [v] : [];
      }
      return [];
    }

    // Cache simple : id/name → entity reconstruite pour @Ref/[[Wiki]]/Lookup.
    const entityRefCache = new Map<string, unknown>();
    function loadEntityByRef(ref: string): {
      id: string; typeId: string; filePath: string; body: string;
      createdAt: Date; updatedAt: Date; fields: Record<string, FormulaValue>;
    } | null {
      const cached = entityRefCache.get(ref);
      if (cached !== undefined) return cached as ReturnType<typeof loadEntityByRef>;
      // ref = id direct OU name (entity.name dans fields.name OU filename)
      const r =
        row(db.exec(
          `SELECT id, typeId, filePath, createdAt, updatedAt, fields FROM entity
           WHERE vaultId = ? AND id = ?`,
          [vaultId, ref],
        )) ??
        row(db.exec(
          `SELECT id, typeId, filePath, createdAt, updatedAt, fields FROM entity
           WHERE vaultId = ? AND (fields LIKE ? OR filePath LIKE ?) LIMIT 1`,
          [vaultId, `%"name":${JSON.stringify(ref)}%`, `%/${ref}.md`],
        ));
      if (!r) { entityRefCache.set(ref, null); return null; }
      let fields: Record<string, unknown> = {};
      try { fields = JSON.parse((r["fields"] as string) || "{}") as Record<string, unknown>; }
      catch { fields = {}; }
      const fv: Record<string, FormulaValue> = {};
      for (const [k, v] of Object.entries(fields)) fv[k] = toFormulaValue(v);
      const out = {
        id: r["id"] as string,
        typeId: r["typeId"] as string,
        filePath: (r["filePath"] as string) ?? "",
        body: "",
        createdAt: new Date((r["createdAt"] as string) ?? Date.now()),
        updatedAt: new Date((r["updatedAt"] as string) ?? Date.now()),
        fields: fv,
      };
      entityRefCache.set(ref, out);
      return out;
    }

    function loadEntitiesOfType(typeIdOrName: string): unknown[] {
      // typeId direct
      let typeId = typeIdOrName;
      const direct = row(db.exec(`SELECT id FROM entity_type WHERE id = ? AND vaultId = ?`, [typeIdOrName, vaultId]));
      if (!direct) {
        const byName = row(db.exec(
          `SELECT id FROM entity_type WHERE vaultId = ? AND (LOWER(name) = LOWER(?) OR LOWER(plural) = LOWER(?))`,
          [vaultId, typeIdOrName, typeIdOrName],
        ));
        if (!byName) return [];
        typeId = byName["id"] as string;
      }
      const ents = rows(db.exec(
        `SELECT id, typeId, filePath, createdAt, updatedAt, fields FROM entity
         WHERE vaultId = ? AND typeId = ?`,
        [vaultId, typeId],
      ));
      return ents.map((r) => {
        let f: Record<string, unknown> = {};
        try { f = JSON.parse((r["fields"] as string) || "{}") as Record<string, unknown>; }
        catch { f = {}; }
        const fv: Record<string, FormulaValue> = {};
        for (const [k, v] of Object.entries(f)) fv[k] = toFormulaValue(v);
        return {
          id: r["id"] as string,
          typeId: r["typeId"] as string,
          filePath: (r["filePath"] as string) ?? "",
          body: "",
          createdAt: new Date((r["createdAt"] as string) ?? Date.now()),
          updatedAt: new Date((r["updatedAt"] as string) ?? Date.now()),
          fields: fv,
        };
      });
    }

    const baseFormulaContext: Omit<FormulaContext, "resolveVariable"> = {
      resolveEntity: (ref) => loadEntityByRef(ref) as never,
      queryEntities: (typeId) => loadEntitiesOfType(typeId) as never,
      getRelations: () => [],
      now: () => new Date(),
    };
    const formulaContext: FormulaContext = {
      ...baseFormulaContext,
      resolveVariable: makeVariableResolver(db, baseFormulaContext),
    };

    function toFormulaValue(v: unknown): FormulaValue {
      if (v === null || v === undefined) return null;
      if (typeof v === "number" || typeof v === "string" || typeof v === "boolean") return v;
      if (v instanceof Date) return v;
      if (Array.isArray(v)) return v.map(toFormulaValue);
      // EntityValue — pass through
      if (typeof v === "object" && v !== null && '_type' in v && (v as { _type: string })._type === 'entity') {
        return v as FormulaValue;
      }
      if (typeof v === "object") return String(v); // fall back to string repr
      return null;
    }

    /**
     * Two-pass relation resolution for base entities.
     * Mutates entity fields in-place (pass 2).
     */
    function resolveBaseEntities(): void {
      // Pass 1: index all entities by id
      const entityById = new Map<string, { id: string; fields: Record<string, unknown>; typeId: string }>();
      for (const list of baseEntities.values()) {
        for (const e of list) entityById.set(e.id, e);
      }

      // Pass 2: substitute relation values
      const metaById = new Map<string, typeof baseInfos[number]>();
      for (const b of baseInfos) metaById.set(b.id, b);

      for (const [typeId, list] of baseEntities) {
        const meta = metaById.get(typeId);
        if (!meta) continue;
        const relFields = meta.fields.filter((f) => f.kind === 'relation' && f.targetTypeId);
        if (relFields.length === 0) continue;

        for (const entity of list) {
          for (const rf of relFields) {
            const raw = entity.fields[rf.id];
            if (rf.cardinality === 'many') {
              let ids: string[] = [];
              if (Array.isArray(raw)) ids = raw.map(String);
              else if (typeof raw === 'string') {
                if (raw.startsWith('[')) {
                  try { ids = (JSON.parse(raw) as unknown[]).map(String); } catch { ids = raw ? [raw] : []; }
                } else { ids = raw ? [raw] : []; }
              }
              (entity.fields as Record<string, unknown>)[rf.id] = ids
                .map((id) => entityById.get(id))
                .filter((e): e is NonNullable<typeof e> => e !== undefined)
                .map((e): FormulaValue => ({ _type: 'entity', entity: { id: e.id, typeId: e.typeId, filePath: '', body: '', createdAt: new Date(), updatedAt: new Date(), fields: e.fields as Record<string, FormulaValue> } as never }));
            } else {
              const id = typeof raw === 'string' ? raw : null;
              const target = id ? entityById.get(id) : undefined;
              (entity.fields as Record<string, unknown>)[rf.id] = target
                ? { _type: 'entity', entity: { id: target.id, typeId: target.typeId, filePath: '', body: '', createdAt: new Date(), updatedAt: new Date(), fields: target.fields as Record<string, FormulaValue> } as never }
                : null;
            }
          }
        }
      }
    }

    // Two-pass relation resolution: resolve relation ids to EntityValues
    if (baseEntities.size > 0 && baseInfos.length > 0) {
      resolveBaseEntities();
    }

    // (safeIdent declared above, reused for cross-base identifier mapping)

    function buildScope(fields: Record<string, unknown>): Scope {
      const scope: Scope = {};
      for (const def of allFieldDefs) {
        const fv = toFormulaValue(fields[def.id] ?? null);
        scope[safeIdent(def.id)] = fv;
        if (def.name) scope[safeIdent(def.name)] = fv;
        // Also expose the bare field name when it is already a safe identifier
        // (no spaces / special chars) — lets users write `Amount + 1`.
        if (def.name && /^[A-Za-z_][A-Za-z0-9_]*$/.test(def.name)) {
          scope[def.name] = fv;
        }
      }
      // thisRow as a synthetic entity so users can write `thisRow.fieldId`
      const thisRowFields: Record<string, FormulaValue> = {};
      for (const def of allFieldDefs) {
        const fv = toFormulaValue(fields[def.id] ?? null);
        thisRowFields[def.id] = fv;
        if (def.name) thisRowFields[def.name] = fv;
      }
      const thisRowEntity = {
        id: "__thisRow__",
        typeId: inp.typeId,
        filePath: "",
        body: "",
        createdAt: new Date(),
        updatedAt: new Date(),
        fields: thisRowFields,
      };
      scope["thisRow"] = { _type: "entity", entity: thisRowEntity as never };

      // Expose each referenced base as a list of entity values so users can
      // write `Contacts.where(currentValue.age > 18).count` and similar.
      for (const b of baseInfos) {
        if (!referencedBaseIds.has(b.id)) continue;
        const ents = baseEntities.get(b.id) ?? [];
        const entityValues: FormulaValue[] = ents.map((e) => {
          const projected: Record<string, FormulaValue> = {};
          for (const def of b.fields) {
            projected[def.id] = toFormulaValue(e.fields[def.id] ?? null);
            if (def.name) projected[def.name] = toFormulaValue(e.fields[def.id] ?? null);
          }
          return {
            _type: "entity",
            entity: {
              id: e.id,
              typeId: e.typeId,
              filePath: "",
              body: "",
              createdAt: new Date(),
              updatedAt: new Date(),
              fields: projected,
            } as never,
          };
        });
        for (const ident of baseIdentifiers(b)) {
          scope[ident] = entityValues;
        }
      }
      return scope;
    }

    function rewritePlaceholders(expr: string): string {
      return expr.replace(/\{([^}]+)\}/g, (_, ref: string) => {
        const def = allFieldDefs.find((d) => d.id === ref || d.name === ref);
        return safeIdent(def?.id ?? ref);
      });
    }

    // ── AST cache : parse une fois par expression, partagé entre lignes ──
    const astCache = new Map<string, { ok: true; ast: FormulaAST } | { ok: false; msg: string }>();
    function getCachedAst(expr: string): { ok: true; ast: FormulaAST } | { ok: false; msg: string } {
      const cached = astCache.get(expr);
      if (cached) return cached;
      const src = rewritePlaceholders(expr);
      const parsed = parseFormula(src);
      const entry = parsed.ok
        ? { ok: true as const, ast: parsed.value }
        : { ok: false as const, msg: parsed.error.message };
      astCache.set(expr, entry);
      if (!entry.ok) console.warn("[formula] parse error:", entry.msg, "in", JSON.stringify(expr));
      return entry;
    }

    function evalFormula(expr: string, fields: Record<string, unknown>): unknown {
      const entry = getCachedAst(expr);
      if (!entry.ok) return `#ERREUR: ${entry.msg}`;
      const scope = buildScope(fields);
      const res = evaluate(entry.ast, formulaContext, scope);
      if (!res.ok) {
        console.warn("[formula] eval error:", res.error.message, "in", JSON.stringify(expr), "scope keys:", Object.keys(scope));
        return `#ERREUR: ${res.error.message}`;
      }
      const v = res.value;
      if (v === null || v === undefined) return null;
      if (v instanceof Date) return v.toISOString();
      if (typeof v === "object" && !Array.isArray(v)) return String(v);
      return v;
    }

    // ── Topo sort + cycle detection sur les formules d'une même base ─────
    // Une formule peut référencer un autre champ formula. Sans tri, on
    // peut consommer une valeur pas encore calculée.
    function localFieldRefs(ast: FormulaAST): Set<string> {
      const out = new Set<string>();
      const visit = (n: FormulaAST): void => {
        switch (n.kind) {
          case "Identifier":
            if (n.name.startsWith("_f_")) out.add(n.name.slice(3));
            else out.add(n.name);
            break;
          case "BinaryOp": visit(n.left); visit(n.right); break;
          case "UnaryOp": visit(n.operand); break;
          case "PropertyAccess": visit(n.object); break;
          case "FunctionCall": n.args.forEach(visit); break;
          case "Conditional": visit(n.condition); visit(n.consequent); visit(n.alternate); break;
          case "ListLiteral": n.elements.forEach(visit); break;
          case "Lambda": visit(n.body); break;
          default: break;
        }
      };
      visit(ast);
      return out;
    }

    function topoSortFormulas(defs: DerivedFieldDef[]): { ordered: DerivedFieldDef[]; cycles: Set<string> } {
      const formulaDefs = defs.filter((d) => d.kind === "formula" && d.expression);
      const idToDef = new Map(formulaDefs.map((d) => [d.id, d] as const));
      const nameToId = new Map(formulaDefs.map((d) => [d.name, d.id] as const));
      const deps = new Map<string, Set<string>>();
      for (const d of formulaDefs) {
        const entry = getCachedAst(d.expression!);
        const refs = entry.ok ? localFieldRefs(entry.ast) : new Set<string>();
        const localDeps = new Set<string>();
        for (const ref of refs) {
          if (idToDef.has(ref)) localDeps.add(ref);
          const byName = nameToId.get(ref);
          if (byName) localDeps.add(byName);
        }
        deps.set(d.id, localDeps);
      }
      // Kahn's algorithm.
      const indeg = new Map<string, number>();
      for (const id of deps.keys()) indeg.set(id, 0);
      for (const ds of deps.values()) for (const d of ds) indeg.set(d, (indeg.get(d) ?? 0)); // ensure key
      const reverse = new Map<string, Set<string>>();
      for (const [from, ds] of deps) for (const to of ds) {
        if (!reverse.has(to)) reverse.set(to, new Set());
        reverse.get(to)!.add(from);
      }
      for (const [from, ds] of deps) indeg.set(from, ds.size);
      const queue: string[] = [];
      for (const [id, n] of indeg) if (n === 0) queue.push(id);
      const ordered: DerivedFieldDef[] = [];
      while (queue.length) {
        const id = queue.shift()!;
        const def = idToDef.get(id);
        if (def) ordered.push(def);
        for (const downstream of reverse.get(id) ?? []) {
          indeg.set(downstream, (indeg.get(downstream) ?? 1) - 1);
          if ((indeg.get(downstream) ?? 0) === 0) queue.push(downstream);
        }
      }
      const cycles = new Set<string>();
      if (ordered.length < formulaDefs.length) {
        for (const d of formulaDefs) if (!ordered.find((o) => o.id === d.id)) cycles.add(d.id);
      }
      return { ordered, cycles };
    }

    const { ordered: orderedFormulaDefs, cycles: cyclicFormulaIds } = topoSortFormulas(allFieldDefs);

    // Pre-collect all related entity IDs across the whole page so we can
    // batch-fetch in one SQL query instead of N per-entity queries.
    const relLookupDefs = derivedDefs.filter(
      (f) => (f.kind === "rollup" || f.kind === "lookup") && f.relationFieldId && f.targetFieldId,
    );

    const entityRelMap = new Map<string, Map<string, string[]>>();
    const allRelIds = new Set<string>();
    if (relLookupDefs.length > 0) {
      for (const entity of allRows) {
        const byField = new Map<string, string[]>();
        for (const d of relLookupDefs) {
          const ids = getRelIds(entity.fields, d.relationFieldId!);
          byField.set(d.id, ids);
          ids.forEach((id) => allRelIds.add(id));
        }
        entityRelMap.set(entity.id, byField);
      }
    }

    const relEntityFields = new Map<string, Record<string, unknown>>();
    if (allRelIds.size > 0) {
      const idList = Array.from(allRelIds);
      const ph = idList.map(() => "?").join(",");
      const relRows = rows(db.exec(`SELECT id, fields FROM entity WHERE id IN (${ph})`, idList));
      for (const r of relRows) {
        const id = r["id"] as string;
        try { relEntityFields.set(id, JSON.parse((r["fields"] as string) || "{}") as Record<string, unknown>); }
        catch { relEntityFields.set(id, {}); }
      }
    }

    function computeRollupVal(relIds: string[], targetFieldId: string, agg: string): unknown {
      const nums = relIds
        .map((id) => relEntityFields.get(id)?.[targetFieldId])
        .filter((v) => v !== null && v !== undefined);
      switch (agg) {
        case "count": return relIds.length;
        case "sum": return nums.reduce<number>((acc, v) => acc + (Number(v) || 0), 0);
        case "avg": return nums.length > 0 ? nums.reduce<number>((a, v) => a + (Number(v) || 0), 0) / nums.length : null;
        case "min": return nums.length > 0 ? Math.min(...nums.map((v) => Number(v) || 0)) : null;
        case "max": return nums.length > 0 ? Math.max(...nums.map((v) => Number(v) || 0)) : null;
        case "all": return nums.every((v) => Boolean(v));
        case "any": return nums.some((v) => Boolean(v));
        default: return null;
      }
    }

    function computeLookupVal(relIds: string[], targetFieldId: string): unknown {
      const vals = relIds
        .map((id) => relEntityFields.get(id)?.[targetFieldId])
        .filter((v) => v !== null && v !== undefined);
      return relIds.length <= 1 ? (vals[0] ?? null) : vals;
    }

    const enrichedRows = derivedDefs.length > 0
      ? allRows.map((entity) => {
          const newFields = { ...entity.fields };
          // Cycles : marquer comme #ERREUR avant éval pour stopper la cascade.
          for (const cid of cyclicFormulaIds) newFields[cid] = "#ERREUR: cycle de dépendance";
          // Formulas dans l'ordre topologique (les referencées d'abord).
          for (const d of orderedFormulaDefs) {
            if (d.expression) newFields[d.id] = evalFormula(d.expression, newFields);
          }
          // Rollup / lookup (n'ont pas de deps entre eux).
          for (const d of derivedDefs) {
            if (d.kind === "rollup" && d.targetFieldId && d.aggregation) {
              const relIds = entityRelMap.get(entity.id)?.get(d.id) ?? [];
              newFields[d.id] = computeRollupVal(relIds, d.targetFieldId, d.aggregation);
            } else if (d.kind === "lookup" && d.targetFieldId) {
              const relIds = entityRelMap.get(entity.id)?.get(d.id) ?? [];
              newFields[d.id] = computeLookupVal(relIds, d.targetFieldId);
            }
          }
          return { ...entity, fields: newFields };
        })
      : allRows;

    // Filter pass — every clause must match (AND). Reading derived columns
    // like `createdAt` / `updatedAt` directly from the row, not from the
    // serialized fields blob, since those are top-level columns.
    function readField(
      ent: { fields: Record<string, unknown>; createdAt: string; updatedAt: string },
      fieldId: string,
    ): unknown {
      if (fieldId === "createdAt" || fieldId === "_createdAt") return ent.createdAt;
      if (fieldId === "updatedAt" || fieldId === "_updatedAt") return ent.updatedAt;
      return ent.fields[fieldId];
    }

    const filtered = enrichedRows.filter((e) =>
      filters.every((f) => matchesFilter(readField(e, f.fieldId), f.op, f.value)),
    );

    // Sort pass — apply sorts in reverse order so the first sort is the
    // primary key (stable sort guarantees secondary sorts don't disturb it).
    const sorted = [...filtered];
    for (let i = sorts.length - 1; i >= 0; i--) {
      const s = sorts[i];
      if (!s) continue;
      const dir = s.direction === "desc" ? -1 : 1;
      sorted.sort((a, b) => dir * compareValues(readField(a, s.fieldId), readField(b, s.fieldId)));
    }

    const paged = sorted.slice(offset, offset + limit);
    return { items: paged, total: filtered.length };
  };

  // ── tags.* ────────────────────────────────────────────────────────────────
  //
  // Output shape mirrors @supernote/ipc TagSchema: { id, name, path, count,
  // color?, parentPath? }. The DB column is `label` but the public schema
  // exposes it as `name` (matching the IPC contract used by the UI).

  const buildTagApi = (r: SqlRow, count: number): unknown => ({
    id: r["id"],
    name: (r["label"] as string) ?? (r["path"] as string),
    path: r["path"],
    count,
    color: (r["color"] as string | null) ?? null,
    parentPath: (r["parentPath"] as string | null) ?? null,
  });

  const tagsList = async (input?: unknown): Promise<unknown> => {
    const { search, prefix } = (input ?? {}) as { search?: string; prefix?: string };
    let sql = `
      SELECT t.id, t.path, t.label, t.parentPath, t.color,
             COUNT(et.entityId) AS cnt
      FROM tag t
      LEFT JOIN entity_tag et ON et.tagId = t.id
      WHERE t.vaultId = ?
    `;
    const params: SqlValue[] = [vaultId];
    if (search && search.trim()) {
      sql += ` AND (t.path LIKE ? OR t.label LIKE ?)`;
      const like = `%${search.trim()}%`;
      params.push(like, like);
    }
    if (prefix && prefix.trim()) {
      sql += ` AND t.path LIKE ?`;
      params.push(`${prefix.trim()}%`);
    }
    sql += ` GROUP BY t.id ORDER BY t.path ASC`;
    return rows(db.exec(sql, params)).map((r) =>
      buildTagApi(r, Number(r["cnt"] ?? 0)),
    );
  };

  const findTagByPath = (path: string): SqlRow | null =>
    row(db.exec(`SELECT id, path, label, parentPath, color FROM tag WHERE vaultId = ? AND path = ?`, [vaultId, path]));

  const countForTag = (tagId: string): number => {
    const r = row(db.exec(`SELECT COUNT(*) as cnt FROM entity_tag WHERE tagId = ?`, [tagId]));
    return Number(r?.["cnt"] ?? 0);
  };

  const tagsCreate = async (input: unknown): Promise<unknown> => {
    const { path, label, color } = input as {
      path: string;
      label?: string;
      color?: string | null;
    };
    const cleanPath = path.trim().replace(/^#+/, "");
    if (!cleanPath) throw new Error("tags.create: empty path");
    const segments = cleanPath.split("/");
    const leaf = segments[segments.length - 1] ?? cleanPath;
    const parentPath = segments.length > 1 ? segments.slice(0, -1).join("/") : null;
    const ts = now();

    const existing = findTagByPath(cleanPath);
    if (existing) {
      return buildTagApi(existing, countForTag(existing["id"] as string));
    }

    const id = generateId();
    db.run(
      `INSERT INTO tag (id, vaultId, path, label, parentPath, color, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, vaultId, cleanPath, label ?? leaf, parentPath, color ?? null, ts, ts],
    );
    const fresh = findTagByPath(cleanPath);
    return fresh ? buildTagApi(fresh, 0) : null;
  };

  const tagsUpdate = async (input: unknown): Promise<unknown> => {
    const { path, label, color } = input as {
      path: string;
      label?: string;
      color?: string | null;
    };
    const existing = findTagByPath(path);
    if (!existing) throw new Error(`tags.update: tag '${path}' not found`);
    const newLabel = label ?? (existing["label"] as string);
    const newColor = color === undefined ? (existing["color"] as string | null) : color;
    db.run(
      `UPDATE tag SET label = ?, color = ?, updatedAt = ? WHERE id = ?`,
      [newLabel, newColor, now(), existing["id"] as string],
    );
    const fresh = findTagByPath(path);
    return fresh ? buildTagApi(fresh, countForTag(fresh["id"] as string)) : null;
  };

  const tagsDelete = async (input: unknown): Promise<unknown> => {
    const { path, recursive } = input as { path: string; recursive?: boolean };
    let affected = 0;
    if (recursive) {
      // Match the tag itself plus any descendant in the hierarchy.
      const targets = rows(db.exec(
        `SELECT id FROM tag WHERE vaultId = ? AND (path = ? OR path LIKE ?)`,
        [vaultId, path, `${path}/%`],
      ));
      for (const t of targets) {
        // entity_tag rows are removed by ON DELETE CASCADE on the FK.
        db.run(`DELETE FROM tag WHERE id = ?`, [t["id"] as string]);
        affected++;
      }
    } else {
      const existing = findTagByPath(path);
      if (existing) {
        db.run(`DELETE FROM tag WHERE id = ?`, [existing["id"] as string]);
        affected = 1;
      }
    }
    return { affected };
  };

  /**
   * Rename a tag and cascade through its entire subtree.
   *
   * Hierarchy is encoded in the `path` column (slash-separated). When the
   * caller renames `client` to `clients`, every descendant whose path starts
   * with `client/` must be rewritten as `clients/...` and have its
   * `parentPath` adjusted in lock-step. We do this in one pass per row rather
   * than a single SQL `REPLACE` because we also need to recompute the
   * `parentPath` (which isn't a simple substring of `path`).
   *
   * Tags are stored normalized through `entity_tag(entityId, tagId)`, so
   * entity rows don't carry path strings — just the tag PKs. That means a
   * cascading rename touches the `tag` table only; entities stay consistent
   * because the FK doesn't move.
   */
  const tagsRename = async (input: unknown): Promise<unknown> => {
    const { oldPath, newPath } = input as { oldPath: string; newPath: string };
    const cleanOld = oldPath.trim().replace(/^#+/, "");
    const cleanNew = newPath.trim().replace(/^#+/, "");
    if (!cleanOld || !cleanNew) throw new Error("tags.rename: empty path");
    if (cleanOld === cleanNew) return { affected: 0 };

    const existing = findTagByPath(cleanOld);
    if (!existing) throw new Error(`tags.rename: '${cleanOld}' not found`);

    // Conflict check: refuse if the destination path (or any descendant
    // destination) already exists under a different tag id. We collect the
    // ids in our own subtree first so we can ignore self-overlaps.
    const ownIds = new Set<string>([existing["id"] as string]);
    const subtree = rows(db.exec(
      `SELECT id FROM tag WHERE vaultId = ? AND path LIKE ? || '/%'`,
      [vaultId, cleanOld],
    ));
    for (const r of subtree) ownIds.add(r["id"] as string);
    const conflicts = rows(db.exec(
      `SELECT id, path FROM tag
        WHERE vaultId = ?
          AND (path = ? OR path LIKE ? || '/%')`,
      [vaultId, cleanNew, cleanNew],
    ));
    for (const c of conflicts) {
      if (!ownIds.has(c["id"] as string)) {
        throw new Error(`tags.rename: '${c["path"] as string}' already exists`);
      }
    }

    const ts = now();
    let affected = 0;

    // Update the head tag.
    const headSegs = cleanNew.split("/");
    const headLeaf = headSegs[headSegs.length - 1] ?? cleanNew;
    const headParent = headSegs.length > 1 ? headSegs.slice(0, -1).join("/") : null;
    db.run(
      `UPDATE tag SET path = ?, label = ?, parentPath = ?, updatedAt = ? WHERE id = ?`,
      [cleanNew, headLeaf, headParent, ts, existing["id"] as string],
    );
    affected++;

    // Cascade descendants: their new path = cleanNew + suffix-after-cleanOld.
    const descendants = rows(db.exec(
      `SELECT id, path FROM tag WHERE vaultId = ? AND path LIKE ? || '/%'`,
      [vaultId, cleanOld],
    ));
    for (const d of descendants) {
      const oldDescPath = d["path"] as string;
      const newDescPath = cleanNew + oldDescPath.slice(cleanOld.length);
      const segs = newDescPath.split("/");
      const leaf = segs[segs.length - 1] ?? newDescPath;
      const parent = segs.length > 1 ? segs.slice(0, -1).join("/") : null;
      db.run(
        `UPDATE tag SET path = ?, label = ?, parentPath = ?, updatedAt = ? WHERE id = ?`,
        [newDescPath, leaf, parent, ts, d["id"] as string],
      );
      affected++;
    }

    return { affected };
  };

  /**
   * Move a tag under a new parent (or to the root when `newParentPath` is
   * null). The leaf segment is preserved; we delegate to `tagsRename` to
   * cascade descendants. Bouncing through rename keeps the parentPath
   * recompute logic in one place.
   */
  const tagsMove = async (input: unknown): Promise<unknown> => {
    const { path, newParentPath } = input as { path: string; newParentPath: string | null };
    const cleanPath = path.trim().replace(/^#+/, "");
    if (!cleanPath) throw new Error("tags.move: empty path");
    const cleanParent = newParentPath
      ? newParentPath.trim().replace(/^#+/, "")
      : null;
    const segs = cleanPath.split("/");
    const leaf = segs[segs.length - 1] ?? cleanPath;
    const newPath = cleanParent ? `${cleanParent}/${leaf}` : leaf;
    if (newPath === cleanPath) return { affected: 0 };

    // Refuse moving a tag underneath itself or one of its descendants — that
    // would create a cycle and orphan the moved subtree.
    if (cleanParent && (cleanParent === cleanPath || cleanParent.startsWith(`${cleanPath}/`))) {
      throw new Error("tags.move: cannot move a tag underneath itself");
    }

    return tagsRename({ oldPath: cleanPath, newPath });
  };

  /**
   * Merge `sourcePath` into `targetPath`. Strategy:
   *   1. Resolve / create the target tag.
   *   2. Re-link every entity that points at the source (or, when
   *      `includeDescendants` is false, just the source itself) to the
   *      target. We use `INSERT OR IGNORE` so existing (entity, target)
   *      pairs aren't duplicated.
   *   3. Either delete the source subtree (default) or re-parent it under
   *      the target via cascading rename (when `includeDescendants`).
   */
  const tagsMerge = async (input: unknown): Promise<unknown> => {
    const { sourcePath, targetPath, includeDescendants } = input as {
      sourcePath: string;
      targetPath: string;
      includeDescendants?: boolean;
    };
    const src = sourcePath.trim().replace(/^#+/, "");
    const dst = targetPath.trim().replace(/^#+/, "");
    if (!src || !dst) throw new Error("tags.merge: empty path");
    if (src === dst) throw new Error("tags.merge: source and target are identical");
    if (dst.startsWith(`${src}/`)) {
      throw new Error("tags.merge: target lives underneath source — would create a cycle");
    }

    const srcRow = findTagByPath(src);
    if (!srcRow) throw new Error(`tags.merge: source '${src}' not found`);

    // Resolve or create the target tag in one trip.
    let dstRow = findTagByPath(dst);
    if (!dstRow) {
      await tagsCreate({ path: dst });
      dstRow = findTagByPath(dst);
      if (!dstRow) throw new Error(`tags.merge: failed to create target '${dst}'`);
    }
    const dstId = dstRow["id"] as string;
    const ts = now();

    // Decide which source ids participate in the re-tag step. Include
    // descendants by default so a merge feels like "fold this whole branch
    // into the target".
    const includeAll = includeDescendants !== false;
    const sourceIds = includeAll
      ? rows(db.exec(
          `SELECT id FROM tag WHERE vaultId = ? AND (id = ? OR path LIKE ? || '/%')`,
          [vaultId, srcRow["id"] as string, src],
        )).map((r) => r["id"] as string)
      : [srcRow["id"] as string];

    let reTagged = 0;
    for (const sid of sourceIds) {
      // Move the entity_tag rows from the source to the target. INSERT OR
      // IGNORE handles entities that were already tagged with both. We then
      // delete every link to the source so it can be cleanly removed below.
      const before = countForTag(sid);
      db.run(
        `INSERT OR IGNORE INTO entity_tag (entityId, tagId, createdAt)
         SELECT entityId, ?, ? FROM entity_tag WHERE tagId = ?`,
        [dstId, ts, sid],
      );
      db.run(`DELETE FROM entity_tag WHERE tagId = ?`, [sid]);
      reTagged += before;
    }

    let removed = 0;
    if (includeAll) {
      // Drop the entire source subtree. entity_tag rows for these ids were
      // already cleared above; the FK CASCADE would've handled them anyway.
      const dropTargets = rows(db.exec(
        `SELECT id FROM tag WHERE vaultId = ? AND (id = ? OR path LIKE ? || '/%')`,
        [vaultId, srcRow["id"] as string, src],
      ));
      for (const r of dropTargets) {
        db.run(`DELETE FROM tag WHERE id = ?`, [r["id"] as string]);
        removed++;
      }
    } else {
      // Re-parent direct children of the source under the target (preserving
      // their leaf names) instead of deleting them.
      const directChildren = rows(db.exec(
        `SELECT id, path FROM tag WHERE vaultId = ? AND parentPath = ?`,
        [vaultId, src],
      ));
      for (const child of directChildren) {
        const childPath = child["path"] as string;
        const segs = childPath.split("/");
        const leaf = segs[segs.length - 1] ?? childPath;
        await tagsRename({ oldPath: childPath, newPath: `${dst}/${leaf}` });
      }
      // Finally drop just the source row.
      db.run(`DELETE FROM tag WHERE id = ?`, [srcRow["id"] as string]);
      removed = 1;
    }

    return { reTagged, removed };
  };

  /**
   * List entities carrying a tag.
   *
   * When `recursive` is true (the default for the hierarchical tags UI),
   * also include entities tagged with any descendant of `path` so an entity
   * tagged `client/premium/europe` shows up under `client` as well.
   *
   * The query SELECTs `DISTINCT e.id` because an entity can carry both a
   * parent and a child tag — without DISTINCT it would appear twice in the
   * recursive result.
   */
  const tagsEntities = async (input: unknown): Promise<unknown> => {
    const { path, limit, recursive } = input as {
      path: string;
      limit?: number;
      recursive?: boolean;
    };
    const lim = Math.min(limit ?? 100, 500);
    const includeDescendants = recursive !== false;

    // Resolve target tag ids. When recursive, pull every tag whose path is
    // either an exact match or a descendant. We may legitimately get zero
    // ids if the user clicked on an "intermediate" path that doesn't exist
    // as a tag row yet (paths derived from leaf parent chains) — in that
    // case we fall back to a path-prefix match against the descendants only.
    let tagIds: string[] = [];
    if (includeDescendants) {
      tagIds = rows(db.exec(
        `SELECT id FROM tag WHERE vaultId = ? AND (path = ? OR path LIKE ? || '/%')`,
        [vaultId, path, path],
      )).map((r) => r["id"] as string);
    } else {
      const tag = findTagByPath(path);
      if (tag) tagIds = [tag["id"] as string];
    }

    if (!tagIds.length) return [];

    const placeholders = tagIds.map(() => "?").join(",");
    const entityRows = rows(db.exec(
      `SELECT DISTINCT e.id, e.typeId, et.name AS typeName, e.filePath, e.fields, e.updatedAt
       FROM entity_tag link
       JOIN entity e ON e.id = link.entityId
       JOIN entity_type et ON et.id = e.typeId
       WHERE link.tagId IN (${placeholders})
       ORDER BY e.updatedAt DESC
       LIMIT ?`,
      [...tagIds, lim],
    ));
    return entityRows.map((r) => ({
      id: r["id"],
      typeId: r["typeId"],
      typeName: (r["typeName"] as string) ?? "",
      filePath: (r["filePath"] as string | null) ?? null,
      title: deriveTitle(r["fields"] as string | null, r["filePath"] as string | null),
      updatedAt: (r["updatedAt"] as string) ?? now(),
    }));
  };

  // ── search.* ──────────────────────────────────────────────────────────────

  const searchQuery = async (input: unknown): Promise<unknown> => {
    const { query, typeId, limit, offset } = input as {
      query: string;
      typeId?: string;
      limit?: number;
      offset?: number;
    };
    const lim = limit ?? 20;
    const off = offset ?? 0;

    const t0 = Date.now();

    // Empty query: list most recently updated entities for the typeId so the
    // EntityPicker shows something before the user starts typing. FTS5 MATCH
    // with an empty pattern raises a syntax error, so we read from `entity`
    // directly here instead of going through `entity_fts`.
    if (!query.trim()) {
      let listSql = `
        SELECT e.id, e.typeId, et.name as typeName, e.filePath, e.fields, e.body,
               e.createdAt, e.updatedAt
        FROM entity e
        JOIN entity_type et ON et.id = e.typeId
        WHERE e.vaultId = ?
      `;
      const listParams: SqlValue[] = [vaultId];
      if (typeId) { listSql += ` AND e.typeId = ?`; listParams.push(typeId); }
      listSql += ` ORDER BY e.updatedAt DESC LIMIT ? OFFSET ?`;
      listParams.push(lim, off);
      const recent = rows(db.exec(listSql, listParams));
      const items = recent.map((r) => {
        const body = (r["body"] as string) ?? "";
        const excerpt = body.length > 120 ? body.slice(0, 120) + "..." : body;
        return {
          entityId: r["id"],
          typeId: r["typeId"],
          typeName: r["typeName"],
          filePath: r["filePath"],
          title: deriveTitle(r["fields"] as string | null, r["filePath"] as string | null),
          excerpts: excerpt ? [excerpt] : [],
          score: 1,
          semantic: false,
          tags: [],
        };
      });
      return { items, total: items.length, durationMs: Date.now() - t0 };
    }

    const match = buildFtsMatch(query);
    if (!match) {
      return { items: [], total: 0, durationMs: Date.now() - t0 };
    }

    // Two-pass: a fast COUNT to populate `total` for the UI's pagination
    // controls (matches the old MiniSearch behavior which returned the full
    // filtered length), then the actual paged result. `total` is approximate
    // when typeId narrows the set — same approximation the old code shipped.
    let countSql = `
      SELECT COUNT(*) as c
      FROM entity_fts f
      JOIN entity e ON e.id = f.id
      WHERE f MATCH ? AND e.vaultId = ?
    `;
    const countParams: SqlValue[] = [match, vaultId];
    if (typeId) { countSql += ` AND e.typeId = ?`; countParams.push(typeId); }

    let pageSql = `
      SELECT e.id, e.typeId, et.name as typeName, e.filePath, e.fields, e.body,
             e.createdAt, e.updatedAt,
             snippet(entity_fts, 2, '', '', '…', 16) as bodyExcerpt,
             bm25(entity_fts, 2.0, 1.0, 1.0, 1.5) as bm25
      FROM entity_fts
      JOIN entity e ON e.id = entity_fts.id
      JOIN entity_type et ON et.id = e.typeId
      WHERE entity_fts MATCH ? AND e.vaultId = ?
    `;
    const pageParams: SqlValue[] = [match, vaultId];
    if (typeId) { pageSql += ` AND e.typeId = ?`; pageParams.push(typeId); }
    pageSql += ` ORDER BY bm25 LIMIT ? OFFSET ?`;
    pageParams.push(lim, off);

    let total = 0;
    let matched: SqlRow[];
    try {
      const c = row(db.exec(countSql, countParams));
      total = c ? Number(c["c"] ?? 0) : 0;
      matched = rows(db.exec(pageSql, pageParams));
    } catch (err) {
      // Edge-case MATCH syntax errors → empty result, never crash the UI.
      console.warn("[search] searchQuery MATCH failed", err);
      return { items: [], total: 0, durationMs: Date.now() - t0 };
    }

    const items = matched.map((r) => {
      const body = (r["body"] as string) ?? "";
      const snippet = (r["bodyExcerpt"] as string) ?? "";
      // Fall back to the body prefix when the FTS snippet is empty (e.g.
      // the match landed in title/tags/path rather than body).
      const excerpt = snippet.length > 0
        ? snippet
        : body.length > 120 ? body.slice(0, 120) + "..." : body;
      // bm25 returns 0 (best) → +∞. Normalize to a roughly comparable
      // 0..1 score so the UI's existing score bar stays meaningful.
      const bm25Val = Number(r["bm25"] ?? 0);
      const score = 1 / (1 + Math.max(0, bm25Val));
      return {
        entityId: r["id"],
        typeId: r["typeId"],
        typeName: r["typeName"],
        filePath: r["filePath"],
        title: deriveTitle(r["fields"] as string | null, r["filePath"] as string | null),
        excerpts: excerpt ? [excerpt] : [],
        score,
        semantic: false,
        tags: [],
      };
    });

    return { items, total, durationMs: Date.now() - t0 };
  };

  // ── reindex ───────────────────────────────────────────────────────────────

  const reindexVault = async (): Promise<{ indexed: number; removed?: number }> => {
    // Walk the vault folder first — if this throws (no permission, handle
    // expired, …) we abort BEFORE deleting anything so a transient FSA error
    // can't wipe legitimate DB rows.
    let files: Awaited<ReturnType<typeof walkAllFiles>>;
    try {
      files = await walkAllFiles(vaultHandle);
    } catch (err) {
      console.warn("[reindex] walkAllFiles failed — skipping reconciliation", err);
      return { indexed: 0 };
    }

    // Snapshot filePaths already indexed so we don't double-import, and
    // collect the set of `.excalidraw` paths that are owned by an indexed
    // `.md` (so we don't materialise a standalone canvas entity that would
    // shadow the note's sibling).
    const existing = new Set<string>();
    const claimedExcalidraw = new Set<string>();
    try {
      const allRows = rows(
        db.exec(`SELECT filePath, fields FROM entity WHERE vaultId = ?`, [vaultId]),
      );
      for (const r of allRows) {
        const fp = (r["filePath"] as string | null) ?? "";
        if (!fp) continue;
        existing.add(fp);
        const lower = fp.toLowerCase();
        if (lower.endsWith(".md") || lower.endsWith(".markdown")) {
          // Canonical sibling: same basename + `.excalidraw`.
          const stemMatch = fp.match(/^(.*)\.(md|markdown)$/i);
          if (stemMatch) claimedExcalidraw.add(`${stemMatch[1]}.excalidraw`);
          // Explicit canvasFile frontmatter override.
          try {
            const fields = JSON.parse((r["fields"] as string) || "{}") as Record<string, unknown>;
            const cf = typeof fields["canvasFile"] === "string" ? (fields["canvasFile"] as string) : null;
            if (cf) {
              const dirEnd = fp.lastIndexOf("/");
              const dir = dirEnd >= 0 ? fp.slice(0, dirEnd) : "";
              claimedExcalidraw.add(dir ? `${dir}/${cf}` : cf);
            }
          } catch {
            // ignore malformed fields json
          }
        }
      }
    } catch {
      // entity table not ready yet — treat as empty.
    }

    // Pre-build a set of relative paths for O(1) sibling-presence checks.
    const allRelativePaths = new Set<string>(files.map((f) => f.relativePath));

    // Index existing rows by filePath so the excalidraw branch can detect
    // legacy `canvas` rows we now want to migrate to `note` virtuals.
    const rowsByPath = new Map<string, { id: string; typeId: string }>();
    try {
      for (const r of rows(
        db.exec(`SELECT id, typeId, filePath FROM entity WHERE vaultId = ?`, [vaultId]),
      )) {
        const fp = (r["filePath"] as string | null) ?? "";
        if (fp) rowsByPath.set(fp, { id: r["id"] as string, typeId: r["typeId"] as string });
      }
    } catch {
      // entity table not ready — leave the map empty.
    }

    let indexed = 0;
    let removedLegacyCanvas = 0;
    for (const file of files) {
      // For `.excalidraw` the branch below may need to UPDATE an existing
      // legacy `canvas` row into a virtual `note`, so skip the early
      // `existing.has` guard for that extension and let the branch decide.
      if (existing.has(file.relativePath) && !isExcalidrawExt(file.ext)) continue;
      try {
        if (isMarkdownExt(file.ext)) {
          const content = await file.read();
          const { frontmatter, body } = parseFrontmatter(content);
          const fmId = frontmatter["id"] as string | undefined;
          const typeName = frontmatter["type"] as string | undefined;

          let typeId: string;
          let id: string;
          let fields: Record<string, unknown>;

          if (fmId && typeName) {
            // Supernote-native file: honour the declared type / id.
            const typeRow = row(db.exec(
              `SELECT id FROM entity_type WHERE vaultId = ? AND name = ?`, [vaultId, typeName],
            ));
            if (!typeRow) continue;
            typeId = typeRow["id"] as string;
            id = fmId;
            const topLevelFields = Object.fromEntries(
              Object.entries(frontmatter).filter(
                ([k]) => k !== "id" && k !== "type" && k !== "fields",
              ),
            );
            const nestedRaw = frontmatter["fields"];
            let nestedFields: Record<string, unknown> = {};
            if (nestedRaw && typeof nestedRaw === "object" && !Array.isArray(nestedRaw)) {
              nestedFields = nestedRaw as Record<string, unknown>;
            } else if (typeof nestedRaw === "string") {
              try {
                const parsed = JSON.parse(nestedRaw);
                if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
                  nestedFields = parsed as Record<string, unknown>;
                }
              } catch {
                // Give up; nested stays empty.
              }
            }
            fields = { ...nestedFields, ...topLevelFields };
          } else {
            // Orphan markdown (user-supplied .md without Supernote frontmatter):
            // adopt as a generic note so it's at least visible in the tree.
            // Editing it later re-writes the file with proper frontmatter via
            // the normal entity update path.
            typeId = "note";
            id = generateId();
            const baseName = file.name.replace(/\.(md|markdown)$/i, "");
            fields = { title: baseName };
          }

          const hash = await hashContent(content);
          const ts = now();
          db.run(
            `INSERT INTO entity (id, vaultId, typeId, filePath, fields, body, fileHash, createdAt, updatedAt)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET
               filePath = excluded.filePath, fields = excluded.fields,
               body = excluded.body, fileHash = excluded.fileHash, updatedAt = excluded.updatedAt`,
            [id, vaultId, typeId, file.relativePath, JSON.stringify(fields), body, hash, ts, ts],
          );
          const r = row(db.exec(`SELECT id, typeId, filePath, fields, body FROM entity WHERE id = ?`, [id]));
          if (r) ftsAdd(db, entityToDoc(r));
          existing.add(file.relativePath);
          if (typeId === "note") {
            // Reserve the sibling path so a subsequent .excalidraw in the same
            // pass doesn't get materialised as a duplicate standalone canvas.
            const stemMatch = file.relativePath.match(/^(.*)\.(md|markdown)$/i);
            if (stemMatch) claimedExcalidraw.add(`${stemMatch[1]}.excalidraw`);
          }
          indexed++;
        } else if (isExcalidrawExt(file.ext)) {
          // Skip excalidraws owned by an already-indexed (or freshly-imported)
          // .md sibling — those load via readExcalidrawSibling on demand.
          // BEFORE skipping, also drop any LEGACY standalone `canvas` row
          // that still points at this excalidraw (artefact of a previous
          // version which adopted `.excalidraw` as typeId=canvas before we
          // started exposing them as virtual notes). Without this they'd
          // remain as zombie rows in the DB.
          if (claimedExcalidraw.has(file.relativePath)) {
            const legacy = rowsByPath.get(file.relativePath);
            if (legacy && legacy.typeId === "canvas") {
              db.run(`DELETE FROM entity WHERE id = ?`, [legacy.id]);
              ftsRemove(db, legacy.id);
              rowsByPath.delete(file.relativePath);
              existing.delete(file.relativePath);
              removedLegacyCanvas++;
            }
            continue;
          }
          // Also skip if a sibling .md is present on disk: the markdown branch
          // above (running in this same pass) will adopt it and claim the
          // canvas. Order in `files` is not guaranteed, so check both.
          const stem = file.relativePath.slice(0, -file.ext.length);
          if (allRelativePaths.has(`${stem}.md`) || allRelativePaths.has(`${stem}.markdown`)) continue;
          // Don't re-adopt an excalidraw already claimed by a virtual note we
          // created on a previous pass (its filePath is `${stem}.md` and
          // `fields.canvasFile` points back here).
          const virtualMdPath = `${stem}.md`;
          if (existing.has(virtualMdPath)) {
            // Note virtual déjà créée pour cet excalidraw. Si une LEGACY
            // canvas standalone row coexiste (artefact d'une ancienne pass
            // qui adoptait `.excalidraw` comme typeId=canvas), la supprimer
            // pour qu'elle n'apparaisse pas comme entité dupliquée.
            const legacy = rowsByPath.get(file.relativePath);
            if (legacy && legacy.typeId === "canvas") {
              db.run(`DELETE FROM entity WHERE id = ?`, [legacy.id]);
              ftsRemove(db, legacy.id);
              rowsByPath.delete(file.relativePath);
              existing.delete(file.relativePath);
              removedLegacyCanvas++;
            }
            claimedExcalidraw.add(file.relativePath);
            continue;
          }

          // Surface the orphan `.excalidraw` as a virtual `note` entity so it
          // appears in the sidebar / notes list (typeId=note, filePath points
          // at the not-yet-materialised `.md`). The body is empty until the
          // user types in it — at that point the standard entity update flow
          // writes the `.md` file via `writeVaultFile`, and `canvasFile`
          // keeps the existing `.excalidraw` linked as the note's canvas
          // sibling.
          //
          // Migrate legacy `canvas` standalone rows (created by a previous
          // version of this code that adopted orphan `.excalidraw` as
          // typeId=canvas with filePath=<excalidraw>) into the new shape so
          // the sidebar shows a clickable note instead of an invisible
          // canvas entry.
          const legacyCanvas = rowsByPath.get(file.relativePath);
          const baseName = file.name.slice(0, -file.ext.length);
          const fields = { title: baseName, canvasFile: file.name };
          const ts = now();
          let entityId: string;
          if (legacyCanvas && legacyCanvas.typeId === "canvas") {
            entityId = legacyCanvas.id;
            db.run(
              `UPDATE entity SET typeId = ?, filePath = ?, fields = ?, body = ?, fileHash = NULL, updatedAt = ? WHERE id = ?`,
              ["note", virtualMdPath, JSON.stringify(fields), "", ts, entityId],
            );
            // Drop the stale `existing` entry so the phantom sweep doesn't
            // get confused — the row now lives at `virtualMdPath`.
            existing.delete(file.relativePath);
            rowsByPath.delete(file.relativePath);
          } else if (existing.has(file.relativePath)) {
            // Some other typeId already claims this path (rare); leave it.
            claimedExcalidraw.add(file.relativePath);
            continue;
          } else {
            entityId = generateId();
            db.run(
              `INSERT INTO entity (id, vaultId, typeId, filePath, fields, body, fileHash, createdAt, updatedAt)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [entityId, vaultId, "note", virtualMdPath, JSON.stringify(fields), "", null, ts, ts],
            );
          }
          const r = row(db.exec(`SELECT id, typeId, filePath, fields, body FROM entity WHERE id = ?`, [entityId]));
          if (r) ftsAdd(db, entityToDoc(r));
          // Mark BOTH the virtual md path AND the excalidraw as "claimed" so
          // the phantom sweep below preserves the row even though no `.md`
          // exists on disk (the canvasFile does).
          existing.add(virtualMdPath);
          claimedExcalidraw.add(file.relativePath);
          indexed++;
        } else if (isAttachmentExt(file.ext)) {
          // Adopt arbitrary attachment file (image, pdf, office, csv, gdoc, …)
          // as a virtual `note` entity so it surfaces in the sidebar with its
          // own clickable row. We DON'T allocate a `.md` sibling — the
          // attachment IS the entity's source-of-truth file. Editing the
          // note's body (notes about the attachment) materialises a `.md`
          // sibling later through the standard update path.
          //
          // existing.has(file.relativePath) was checked at the top of the
          // loop and would `continue` — but isExcalidrawExt overrides that,
          // so we re-check explicitly here.
          if (existing.has(file.relativePath)) continue;
          const baseName = file.name.replace(/\.[^.]+$/, "");
          const entityId = generateId();
          const fields: Record<string, unknown> = {
            title: baseName,
            attachmentFile: file.name,
          };
          const ts = now();
          db.run(
            `INSERT INTO entity (id, vaultId, typeId, filePath, fields, body, fileHash, createdAt, updatedAt)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [entityId, vaultId, "note", file.relativePath, JSON.stringify(fields), "", null, ts, ts],
          );
          const r = row(db.exec(`SELECT id, typeId, filePath, fields, body FROM entity WHERE id = ?`, [entityId]));
          if (r) ftsAdd(db, entityToDoc(r));
          existing.add(file.relativePath);
          indexed++;
        }
        // Other extensions: leave untouched for now.
      } catch {
        // Skip unparseable files
      }
    }

    // Remove phantom entities — DB rows whose `filePath` no longer exists
    // on disk. These accumulate when a previous (pre-fix) vault switch wrote
    // the active vault's data into the new vault's `.supernote/index.db`
    // mirror; on next open we'd hydrate from that polluted mirror and the
    // sidebar would show folders that don't physically exist in the current
    // vault folder. We only run this branch when the walk succeeded (we're
    // inside the try/catch-protected path above) so a transient FSA error
    // can't trigger a mass delete.
    let removed = 0;
    try {
      // Build the authoritative set of on-disk paths the walk just produced.
      const onDisk = allRelativePaths;
      // Also tolerate `.excalidraw` siblings of indexed markdown files even
      // if the user deleted just the sibling — keep the note entity, the
      // canvas will simply read as null on next access.
      const allRowsForSweep = rows(
        db.exec(
          `SELECT id, filePath, fields FROM entity WHERE vaultId = ? AND sourceVaultId IS NULL`,
          [vaultId],
        ),
      );
      for (const r of allRowsForSweep) {
        const fp = (r["filePath"] as string | null) ?? "";
        if (!fp) continue;
        if (onDisk.has(fp)) continue;
        // Tolerate the markdown-vs-markdown-extension casing oddity.
        const lower = fp.toLowerCase();
        if (lower.endsWith(".md") || lower.endsWith(".markdown")) {
          if (onDisk.has(fp.replace(/\.md$/i, ".markdown"))) continue;
          if (onDisk.has(fp.replace(/\.markdown$/i, ".md"))) continue;
        }
        // Virtual `note` rows we created to surface an orphan `.excalidraw`
        // file in the UI: the `.md` itself isn't on disk yet (will be
        // materialised on first user edit) but the `canvasFile` IS — keep
        // the row so the sidebar entry stays clickable.
        try {
          const fields = JSON.parse((r["fields"] as string) || "{}") as Record<string, unknown>;
          const canvasFile = typeof fields["canvasFile"] === "string" ? (fields["canvasFile"] as string) : null;
          if (canvasFile) {
            const dirEnd = fp.lastIndexOf("/");
            const dir = dirEnd >= 0 ? fp.slice(0, dirEnd) : "";
            const canvasPath = dir ? `${dir}/${canvasFile}` : canvasFile;
            if (onDisk.has(canvasPath)) continue;
          }
        } catch {
          // malformed fields json — fall through to delete
        }
        const id = r["id"] as string;
        db.run(`DELETE FROM entity WHERE id = ?`, [id]);
        ftsRemove(db, id);
        removed++;
      }
      if (removed > 0) {
        console.info(`[reindex] removed ${removed} phantom entit(y/ies) (filePath not on disk)`);
      }
    } catch (err) {
      console.warn("[reindex] phantom sweep failed (non-fatal)", err);
    }

    if (removedLegacyCanvas > 0) {
      console.info(`[reindex] removed ${removedLegacyCanvas} legacy canvas row(s) superseded by virtual note`);
    }

    // Full FTS5 rebuild after a reindex batch — cheaper than auditing each
    // file's tag join state, and keeps tags consistent if a file's frontmatter
    // changed since the last index pass.
    if (indexed > 0 || removed > 0 || removedLegacyCanvas > 0) {
      ftsRebuild(db, vaultId);
    }

    return { indexed, removed: removed + removedLegacyCanvas };
  };

  // ── variables.* ───────────────────────────────────────────────────────────

  const variablesList = async (): Promise<unknown> => listVariables(db);

  const variablesGet = async (input: unknown): Promise<unknown> =>
    getVariable(db, (input as { id: string }).id);

  const variablesCreate = async (input: unknown): Promise<unknown> => {
    const parsed = VariableInputSchema.safeParse(input);
    if (!parsed.success) {
      throw new Error(
        `variable invalide : ${parsed.error.issues.map((i) => `${i.path.join(".") || "input"} ${i.message}`).join("; ")}`,
      );
    }
    const id = generateId();
    return insertVariable(db, { id, ...(parsed.data as VariableInput) });
  };

  const variablesUpdate = async (input: unknown): Promise<unknown> => {
    const { id, patch } = input as { id: string; patch: Partial<VariableInput> };
    const parsed = VariableInputSchema.partial().safeParse(patch);
    if (!parsed.success) {
      throw new Error(
        `variable invalide : ${parsed.error.issues.map((i) => `${i.path.join(".") || "input"} ${i.message}`).join("; ")}`,
      );
    }
    return updateVariable(db, id, parsed.data as Partial<VariableInput>);
  };

  const variablesDelete = async (input: unknown): Promise<unknown> => {
    const { id } = input as { id: string };
    deleteVariable(db, id);
    return { id, deleted: true };
  };

  const variablesEvaluate = async (input: unknown): Promise<unknown> => {
    const { id } = input as { id: string };
    const v = getVariable(db, id);
    if (!v) return { value: null, error: `variable ${id} not found` };
    try {
      const { context, baseScope } = buildVaultFormulaContext(db, vaultId);
      const val = makeVariableResolver(db, context, new Set(), baseScope)(v.name);
      return { value: JSON.stringify(val), error: null };
    } catch (e) {
      return { value: null, error: e instanceof Error ? e.message : String(e) };
    }
  };

  // Évaluation libre d'une expression de formule (utilisée par le rendu des
  // formules inline/block dans les notes). Donne accès aux bases via le scope
  // et aux variables globales via le resolver.
  const formulasEvaluate = async (input: unknown): Promise<unknown> => {
    const { expression } = input as { expression: string };
    if (!expression || !expression.trim()) {
      return { value: null, error: "(vide)" };
    }
    const parsed = parseFormula(expression);
    if (!parsed.ok) {
      return { value: null, error: parsed.error.message };
    }
    try {
      const { context, baseScope } = buildVaultFormulaContext(db, vaultId);
      const fullCtx: FormulaContext = {
        ...context,
        resolveVariable: makeVariableResolver(db, context, new Set(), baseScope),
      };
      const result = evaluate(parsed.value, fullCtx, baseScope);
      if (!result.ok) return { value: null, error: result.error.message };
      return { value: JSON.stringify(result.value), error: null };
    } catch (e) {
      return { value: null, error: e instanceof Error ? e.message : String(e) };
    }
  };

  // ── system.* ──────────────────────────────────────────────────────────────

  const systemGetAppInfo = async (): Promise<unknown> => ({
    version: "0.0.0-pwa",
    platform: "browser",
    userDataPath: "",
    vaultPath: "",
  });

  // ── vault.readFile / vault.writeFile ──────────────────────────────────────

  /**
   * Translate Chromium's terse FSA error messages into something the user
   * can act on. The browser raises e.g. `NotReadableError: "The requested
   * file could not be read, typically due to permission problems that have
   * occurred after a reference to a file was acquired."` — accurate but
   * unhelpful: 99 % of the time the file is cloud-synced (Google Drive
   * Stream, OneDrive Files On-Demand) and hasn't been materialised
   * locally yet, OR the vault folder permission was implicitly downgraded.
   */
  function friendlyFsaError(path: string, err: unknown): Error {
    const name = (err as DOMException)?.name ?? "";
    const msg = (err as Error)?.message ?? String(err);
    if (name === "NotReadableError") {
      return new Error(
        `Fichier "${path}" illisible — souvent un fichier cloud (Google Drive / OneDrive) pas encore téléchargé localement, ou un .gdoc/.gsheet stocké comme placeholder. Marque-le "Disponible hors ligne" dans Google Drive, ou re-pick le dossier vault pour rafraîchir les permissions. [${name}: ${msg}]`,
      );
    }
    if (name === "NotAllowedError") {
      return new Error(
        `Permission refusée sur "${path}". Re-pick le dossier vault pour ré-accorder l'accès. [${name}]`,
      );
    }
    if (name === "NotFoundError") {
      return new Error(`Fichier introuvable : "${path}". [${name}]`);
    }
    return new Error(`Lecture impossible "${path}" : ${msg}`);
  }

  //
  // Stream raw file content from the vault back to the main thread. Used by
  // the attachment viewer layer (`AttachmentRouter` → image/pdf/csv/…) so
  // those viewers don't need to talk to the FSA handle directly (it lives in
  // this worker). Returns BOTH the binary bytes (ArrayBuffer) and, for text
  // formats, the decoded text — the caller picks whichever it needs.
  //
  // Path normalisation matches the `entitiesUpdate` write path: strip
  // leading slashes and `..` segments so a hostile caller can't escape the
  // vault root.
  const vaultReadFile = async (input: unknown): Promise<unknown> => {
    const { path } = input as { path: string };
    const clean = path.replace(/\.\./g, "").replace(/^\/+|\/+$/g, "").trim();
    if (!clean) throw new Error("vault.readFile: empty path");
    const segments = clean.split("/");
    // Single retry after 250ms — covers the common case of a cloud-synced
    // file that's mid-download when we first hit it (Google Drive Stream,
    // OneDrive Files On-Demand, etc.). FSA `NotReadableError` is what the
    // browser raises before the placeholder is materialised.
    let bytes: ArrayBuffer;
    try {
      bytes = await readVaultFileBinary(vaultHandle, segments);
    } catch (err) {
      const name = (err as DOMException)?.name ?? "";
      if (name === "NotReadableError" || name === "NotAllowedError" || name === "NotFoundError") {
        await new Promise((r) => setTimeout(r, 250));
        try {
          bytes = await readVaultFileBinary(vaultHandle, segments);
        } catch (err2) {
          throw friendlyFsaError(clean, err2);
        }
      } else {
        throw friendlyFsaError(clean, err);
      }
    }
    // Try to decode as UTF-8 text — best-effort so binary files don't crash.
    // The caller decides whether `text` is meaningful for its file type.
    let text: string | null = null;
    try {
      text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    } catch {
      text = null;
    }
    return { bytes, text, size: bytes.byteLength };
  };

  // ── vault.writeFile ───────────────────────────────────────────────────────
  //
  // Symmetric write-side: save raw bytes back to a vault file. Used by the
  // attachment editor layer (CSV, XLSX) to persist edits to the original
  // binary file. Serialised per-path through `runSerialized` so concurrent
  // saves from the same editor (rapid typing → debounced flushes) don't race
  // on FSA `createWritable` — exactly the same race condition we already
  // fixed for `entitiesUpdate` (commit 6faa8e1). After the write, also
  // updates the entity's `fileHash` and `updatedAt` if the path matches an
  // attachment entity row (best-effort: missing row is fine, write still
  // succeeds).
  const vaultWriteFile = async (input: unknown): Promise<unknown> => {
    const { path, bytes } = input as {
      path: string;
      bytes: ArrayBuffer | Uint8Array;
    };
    const clean = path.replace(/\.\./g, "").replace(/^\/+|\/+$/g, "").trim();
    if (!clean) throw new Error("vault.writeFile: empty path");
    const segments = clean.split("/");
    return runSerialized(clean, async () => {
      try {
        await writeVaultFileBinary(vaultHandle, segments, bytes);
      } catch (err) {
        throw friendlyFsaError(clean, err);
      }
      // Refresh the SQL row's updatedAt + fileHash if this path is a known
      // entity (typically an attachment virtual note). Optional but keeps
      // the entity's timestamp in sync so the sidebar surfaces the change.
      try {
        const u8 =
          bytes instanceof Uint8Array
            ? bytes
            : new Uint8Array(bytes as ArrayBuffer);
        // hashContent expects string; cheap detour via Blob → arrayBuffer
        // would re-allocate, so we hash the bytes directly here. Cast to
        // BufferSource: `subtle.digest` expects BufferSource, and TS narrows
        // `Uint8Array` weirdly against the overload signature.
        const hashBuf = await crypto.subtle.digest("SHA-256", u8 as BufferSource);
        const hash = Array.from(new Uint8Array(hashBuf))
          .map((b) => b.toString(16).padStart(2, "0"))
          .join("");
        const ts = now();
        db.run(
          `UPDATE entity SET fileHash = ?, updatedAt = ? WHERE vaultId = ? AND filePath = ?`,
          [hash, ts, vaultId, clean],
        );
      } catch (err) {
        console.warn(
          `[vault.writeFile] hash/sql update failed for ${clean} (write itself succeeded)`,
          err,
        );
      }
      return { path: clean, size: (bytes as ArrayBuffer).byteLength ?? (bytes as Uint8Array).byteLength };
    });
  };

  // ── sync.* (online realtime sync) ────────────────────────────────────────────
  //
  // The online-sync client (main thread) bridges these handlers to a remote
  // op-log. `snapshot` seeds the server with the whole vault; `applyOps`
  // materialises peers' ops into the local SQLite + FSA. Crucially `applyOps`
  // does NOT invoke the lifecycle hooks: those drive the ENTITY_CHANGE
  // emission, and re-emitting a freshly-applied remote op would echo it
  // straight back to the server, creating an infinite loop.

  type SyncOp = {
    opId: string;
    clientId: string;
    kind: "upsert" | "delete";
    entityId: string;
    ts: number;
    payload?: {
      id: string;
      typeId: string;
      typeName: string;
      filePath: string;
      fields: Record<string, unknown>;
      body: string;
      tags: string[];
      createdAt: string;
      updatedAt: string;
    };
  };

  const isMarkdownPath = (p: string): boolean => {
    const lower = p.toLowerCase();
    return lower.endsWith(".md") || lower.endsWith(".markdown");
  };

  /** Full snapshot of the vault as one `upsert` op per entity. */
  const syncSnapshot = async (): Promise<unknown> => {
    const res = db.exec(
      `SELECT e.id, e.typeId, et.name AS typeName, e.filePath, e.fields, e.body,
              e.createdAt, e.updatedAt,
              (SELECT GROUP_CONCAT(t.path, char(31))
                 FROM entity_tag etag JOIN tag t ON t.id = etag.tagId
                WHERE etag.entityId = e.id) AS tagPaths
         FROM entity e JOIN entity_type et ON et.id = e.typeId
        WHERE e.vaultId = ? AND e.sourceVaultId IS NULL`,
      [vaultId],
    );
    const ops: SyncOp[] = rows(res).map((r) => {
      const updatedAt = (r["updatedAt"] as string) ?? now();
      const tagPaths = r["tagPaths"] as string | null;
      return {
        opId: generateId(),
        clientId: "",
        kind: "upsert",
        entityId: r["id"] as string,
        ts: Date.parse(updatedAt) || Date.now(),
        payload: {
          id: r["id"] as string,
          typeId: r["typeId"] as string,
          typeName: (r["typeName"] as string) ?? "",
          filePath: (r["filePath"] as string) ?? "",
          fields: safeParseFieldsBlob((r["fields"] as string) || "{}"),
          body: (r["body"] as string) ?? "",
          tags: tagPaths ? tagPaths.split("").filter(Boolean) : [],
          createdAt: (r["createdAt"] as string) ?? updatedAt,
          updatedAt,
        },
      };
    });
    return { ops, generatedAt: Date.now() };
  };

  /** Local state summary for the sync UI. */
  const syncHead = async (): Promise<unknown> => {
    const r = row(db.exec(`SELECT COUNT(*) AS c FROM entity WHERE vaultId = ?`, [vaultId]));
    return { vaultId, entityCount: r ? Number(r["c"]) : 0 };
  };

  /** Materialise a batch of remote ops into the local vault. LWW, no echo. */
  const syncApplyOps = async (input: unknown): Promise<unknown> => {
    const { ops, sourceVaultId } = (input as {
      ops?: SyncOp[];
      sourceVaultId?: string;
    }) ?? {};
    const provenance = sourceVaultId ?? null;
    let applied = 0;
    let skipped = 0;
    for (const op of ops ?? []) {
      try {
        const existing = row(db.exec(
          `SELECT id, filePath, updatedAt, sourceVaultId FROM entity WHERE id = ?`,
          [op.entityId],
        ));
        const existingTs = existing ? Date.parse(existing["updatedAt"] as string) || 0 : 0;
        const opTs = op.payload ? Date.parse(op.payload.updatedAt) || op.ts : op.ts;
        // Last-write-wins: ignore ops not strictly newer than local state.
        if (existing && opTs < existingTs) {
          skipped++;
          continue;
        }

        // Provenance invariant: never let an op of one provenance overwrite an
        // entity owned by a different provenance (native = null included).
        if (
          existing &&
          crossProvenanceCollision(
            { existingSource: (existing["sourceVaultId"] as string | null) ?? null },
            provenance,
          )
        ) {
          console.warn(
            `[sync.applyOps] skip ${op.entityId}: cross-provenance (local=${existing["sourceVaultId"]}, op=${provenance})`,
          );
          skipped++;
          continue;
        }

        if (op.kind === "delete") {
          if (existing) {
            const filePath = (existing["filePath"] as string) ?? "";
            if (filePath) {
              try {
                await deleteVaultFile(vaultHandle, filePath.split("/"));
              } catch {
                /* already gone */
              }
              await deleteExcalidrawSibling(vaultHandle, filePath);
            }
            db.run(`DELETE FROM entity WHERE id = ?`, [op.entityId]);
            ftsRemove(db, op.entityId);
            applied++;
          } else {
            skipped++;
          }
          continue;
        }

        // upsert
        const payload = op.payload;
        if (!payload) {
          skipped++;
          continue;
        }
        let typeRow = row(db.exec(`SELECT name FROM entity_type WHERE id = ?`, [payload.typeId]));
        if (!typeRow) {
          // Unknown entity type on this device — create a minimal non-system
          // type on the fly so mounted (or freshly-synced) entities can satisfy
          // the FK instead of being dropped.
          const nowIso = now();
          db.run(
            `INSERT OR IGNORE INTO entity_type (id, vaultId, name, plural, fields, isSystem, createdAt, updatedAt)
             VALUES (?, ?, ?, ?, '[]', 0, ?, ?)`,
            [
              payload.typeId,
              vaultId,
              payload.typeName || payload.typeId,
              payload.typeName || payload.typeId,
              nowIso,
              nowIso,
            ],
          );
          typeRow = { name: payload.typeName || payload.typeId };
        }
        // Mounted ops store under `@mounts/<slug>/…`; native ops keep their path.
        const { filePath: storedPath } = resolveMountWrite(payload.filePath, provenance);
        // Guard against filePath collisions with a DIFFERENT entity (the
        // unique(vaultId, filePath) constraint). Don't clobber a local note.
        const pathOwner = row(db.exec(
          `SELECT id FROM entity WHERE vaultId = ? AND filePath = ? LIMIT 1`,
          [vaultId, storedPath],
        ));
        if (pathOwner && (pathOwner["id"] as string) !== op.entityId) {
          console.warn(
            `[sync.applyOps] skip ${op.entityId}: filePath ${storedPath} owned by ${pathOwner["id"]}`,
          );
          skipped++;
          continue;
        }

        const fields = { ...payload.fields };
        // Strip a stray filePath key so it isn't double-stored in the blob.
        delete (fields as Record<string, unknown>)["filePath"];
        let hash = "";
        // Only markdown entities round-trip to a file. Attachments / canvas
        // siblings aren't transported in this MVP — we still upsert the DB
        // row so metadata stays in sync.
        if (provenance === null && isMarkdownPath(payload.filePath)) {
          const frontmatter: Record<string, unknown> = {
            id: op.entityId,
            type: typeRow["name"],
            ...fields,
          };
          const content = serializeFrontmatter(frontmatter, payload.body ?? "");
          await writeVaultFile(vaultHandle, payload.filePath.split("/"), content);
          hash = await hashContent(content);
        }

        if (existing) {
          db.run(
            `UPDATE entity SET typeId = ?, filePath = ?, fields = ?, body = ?, fileHash = ?, sourceVaultId = ?, createdAt = ?, updatedAt = ? WHERE id = ?`,
            [
              payload.typeId,
              storedPath,
              JSON.stringify(fields),
              payload.body ?? "",
              hash,
              provenance,
              payload.createdAt,
              payload.updatedAt,
              op.entityId,
            ],
          );
        } else {
          db.run(
            `INSERT INTO entity (id, vaultId, typeId, filePath, fields, body, fileHash, sourceVaultId, createdAt, updatedAt)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              op.entityId,
              vaultId,
              payload.typeId,
              storedPath,
              JSON.stringify(fields),
              payload.body ?? "",
              hash,
              provenance,
              payload.createdAt,
              payload.updatedAt,
            ],
          );
        }

        db.run(`DELETE FROM entity_tag WHERE entityId = ?`, [op.entityId]);
        await applyEntityTags(db, vaultId, op.entityId, payload.tags ?? [], payload.updatedAt);
        ftsAdd(db, {
          id: op.entityId,
          typeId: payload.typeId,
          title: deriveTitle(JSON.stringify(fields), payload.filePath),
          body: payload.body ?? "",
          tags: (payload.tags ?? []).join(" "),
          path: derivePath(storedPath),
        });
        applied++;
      } catch (err) {
        console.warn(`[sync.applyOps] op ${op.opId} failed (non-fatal)`, err);
        skipped++;
      }
    }
    return { applied, skipped };
  };

  /** Supprime toutes les entités d'une provenance donnée (démontage). */
  const syncPurgeMounted = async (input: unknown): Promise<unknown> => {
    const { sourceVaultId } = (input as { sourceVaultId?: string }) ?? {};
    if (!sourceVaultId) return { removed: 0 };
    const victims = rows(db.exec(
      `SELECT id FROM entity WHERE vaultId = ? AND sourceVaultId = ?`,
      [vaultId, sourceVaultId],
    ));
    for (const v of victims) {
      const id = v["id"] as string;
      db.run(`DELETE FROM entity WHERE id = ?`, [id]);
      ftsRemove(db, id);
    }
    return { removed: victims.length };
  };

  // ── Dispatch table ─────────────────────────────────────────────────────────

  return {
    "vault.getCurrent": vaultGetCurrent,
    "vault.listVaults": vaultListVaults,
    "vault.open": async () => vaultGetCurrent(),
    "vault.close": async () => null,
    "vault.addVault": async () => vaultGetCurrent(),
    "vault.removeVault": async () => null,

    "vault.folders.list": foldersList,
    "vault.folders.add": foldersAdd,
    "vault.folders.rename": foldersRename,
    "vault.folders.delete": foldersDelete,
    "vault.folders.update": foldersUpdate,

    "entities.list": entitiesList,
    "entities.get": entitiesGet,
    "entities.create": entitiesCreate,
    "entities.update": entitiesUpdate,
    "entities.delete": entitiesDelete,
    "entities.search": entitiesSearch,
    "entities.listByDateRange": entitiesListByDateRange,
    "entities.backlinkCounts": entitiesBacklinkCounts,
    "entities.getRelated": entitiesGetRelated,
    "entities.getBacklinks": entitiesGetBacklinks,

    "schemas.list": schemasList,
    "schemas.get": schemasGet,
    "schemas.create": schemasCreate,
    "schemas.update": schemasUpdate,
    "schemas.delete": schemasDelete,

    "views.list": viewsList,
    "views.get": viewsGet,
    "views.create": viewsCreate,
    "views.update": viewsUpdate,
    "views.delete": viewsDelete,
    "views.ensureDefault": viewsEnsureDefault,
    "views.queryForView": viewsQueryForView,

    "tags.list": tagsList,
    "tags.create": tagsCreate,
    "tags.update": tagsUpdate,
    "tags.delete": tagsDelete,
    "tags.rename": tagsRename,
    "tags.move": tagsMove,
    "tags.merge": tagsMerge,
    "tags.entities": tagsEntities,

    "search.query": searchQuery,
    "search.semantic": async () => ({ items: [], total: 0, durationMs: 0 }),
    "search.hybrid": searchQuery,

    "system.getAppInfo": systemGetAppInfo,

    "vault.reindex": reindexVault,
    "vault.readFile": vaultReadFile,
    "vault.writeFile": vaultWriteFile,

    "variables.list": variablesList,
    "variables.get": variablesGet,
    "variables.create": variablesCreate,
    "variables.update": variablesUpdate,
    "variables.delete": variablesDelete,
    "variables.evaluate": variablesEvaluate,

    "formulas.evaluate": formulasEvaluate,

    "sync.snapshot": syncSnapshot,
    "sync.head": syncHead,
    "sync.applyOps": syncApplyOps,
    "sync.purgeMounted": syncPurgeMounted,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Parse the JSON-encoded `fields` blob defensively. A previous bad code path
 * could store the blob as a string-of-JSON-string (or even deeper), which
 * makes plain `JSON.parse` return a string. Spreading that string elsewhere
 * yields character-indexed keys and silently corrupts the entity. We unwrap
 * up to 5 layers and refuse anything that doesn't end up as a plain object.
 */
function safeParseFieldsBlob(raw: string): Record<string, unknown> {
  if (!raw) return {};
  try {
    let parsed: unknown = JSON.parse(raw);
    for (let i = 0; i < 5 && typeof parsed === "string"; i++) {
      try { parsed = JSON.parse(parsed); } catch { break; }
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const obj = parsed as Record<string, unknown>;
    // Strip numeric character-index keys that came from a previous bug where
    // a JSON string was spread into the fields object (`{"0":"{","1":"\\\"",
    // "2":"t",…, "title":"Réunion…"}`). The real fields are the named keys.
    const cleaned: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (/^\d+$/.test(k)) continue;
      // Detect over-escaped JSON-looking strings (`canvas` and friends that
      // accumulated backslashes through bad round-trips). Try to recover via
      // repeated JSON.parse; if unrecoverable, drop the value so a fresh save
      // can re-write a clean blob — better an empty canvas than a permanent
      // bag of `\\\\\\\\\\` that grows on every reload.
      if (typeof v === "string" && (v.startsWith("{") || v.startsWith("["))) {
        // Heuristic: any JSON-looking string with 4+ consecutive backslashes
        // is corrupted past the point of round-trip recovery.
        if (/\\{4,}/.test(v)) {
          // Skip — equivalent to dropping the field.
          continue;
        }
        let cur: unknown = v;
        for (let i = 0; i < 6 && typeof cur === "string"; i++) {
          try {
            const next = JSON.parse(cur);
            if (typeof next === "string") { cur = next; continue; }
            cleaned[k] = JSON.stringify(next);
            break;
          } catch {
            break;
          }
        }
        if (cleaned[k] === undefined) cleaned[k] = v;
      } else {
        cleaned[k] = v;
      }
    }
    return cleaned;
  } catch {
    return {};
  }
}

/**
 * Two field names carry a serialized CanvasDocument JSON:
 *  - canvas standalone entities use `data`
 *  - notes with a canvas view use `canvas`
 *
 * Returns `{ fieldName, json }` when one is present with non-empty
 * JSON-looking content, otherwise null.
 */
function extractCanvasField(
  fields: Record<string, unknown>,
): { fieldName: "data" | "canvas"; json: string } | null {
  for (const name of ["data", "canvas"] as const) {
    const v = fields[name];
    if (
      typeof v === "string" &&
      v.trim().length > 0 &&
      v.trim().startsWith("{")
    ) {
      return { fieldName: name, json: v };
    }
  }
  return null;
}

/** Parse a frontmatter-stored canvas JSON into the shape expected by the bridge. */
function parseCanvasJson(json: string): {
  nodes: unknown[];
  edges: unknown[];
  excalidrawElements?: unknown[];
} {
  try {
    const parsed = JSON.parse(json) as Partial<{
      nodes: unknown;
      edges: unknown;
      excalidrawElements: unknown;
    }>;
    return {
      nodes: Array.isArray(parsed.nodes) ? parsed.nodes : [],
      edges: Array.isArray(parsed.edges) ? parsed.edges : [],
      ...(Array.isArray(parsed.excalidrawElements)
        ? { excalidrawElements: parsed.excalidrawElements }
        : {}),
    };
  } catch {
    return { nodes: [], edges: [] };
  }
}

function entityRowToApi(r: SqlRow): unknown {
  const fields = safeParseFieldsBlob((r["fields"] as string) || "{}");
  // tagPaths is GROUP_CONCAT of `tag.path` with US (\x1F) separator. NULL
  // when the entity has no tags (correlated sub-select returned no rows).
  // Splitting on a non-printable separator is safe even when paths contain
  // commas, quotes, or other punctuation users might type into a tag.
  const rawTags = r["tagPaths"];
  const tags =
    typeof rawTags === "string" && rawTags.length > 0 ? rawTags.split("\x1F") : [];
  return {
    id: r["id"],
    typeId: r["typeId"],
    typeName: r["typeName"] ?? "",
    filePath: r["filePath"] ?? "",
    fields,
    body: r["body"] ?? "",
    tags,
    createdAt: r["createdAt"] ?? now(),
    updatedAt: r["updatedAt"] ?? now(),
  };
}

async function applyEntityTags(
  db: Database,
  vaultId: string,
  entityId: string,
  tags: string[],
  ts: string,
): Promise<void> {
  for (const tagPath of tags) {
    let tagRow = row(db.exec(`SELECT id FROM tag WHERE vaultId = ? AND path = ?`, [vaultId, tagPath]));
    if (!tagRow) {
      const tagId = generateId();
      db.run(
        `INSERT OR IGNORE INTO tag (id, vaultId, path, label, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)`,
        [tagId, vaultId, tagPath, tagPath.split("/").pop() ?? tagPath, ts, ts],
      );
      tagRow = { id: tagId };
    }
    const tagId = tagRow["id"] ?? null;
    db.run(
      `INSERT OR IGNORE INTO entity_tag (entityId, tagId, createdAt) VALUES (?, ?, ?)`,
      [entityId, tagId, ts],
    );
  }
}
