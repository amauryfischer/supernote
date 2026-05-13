/**
 * worker-router — handles tRPC-style route dispatch inside the vault web worker.
 *
 * Implements the same procedure surface as the Electron main process:
 * vault.*, entities.*, schemas.*, tags.*, search.*
 *
 * Uses sql.js Database directly (no Prisma) and FSA for file I/O.
 *
 * Browser mode uses MiniSearch in-memory FTS instead of SQLite FTS5
 * (sql.js standard build doesn't include FTS5).
 * Trade-off acceptable for vaults < 5k entités.
 */

import MiniSearch from "minisearch";
import type { Database } from "sql.js";
import {
  parseFrontmatter,
  serializeFrontmatter,
  walkMarkdownFiles,
  writeVaultFile,
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
   * spaces so MiniSearch tokenizes each segment. Lets users find a note by
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

// ── MiniSearch index ──────────────────────────────────────────────────────────

let miniSearch: MiniSearch<EntityDoc> | null = null;

function createMiniSearch(): MiniSearch<EntityDoc> {
  return new MiniSearch<EntityDoc>({
    fields: ["title", "body", "tags", "path"],
    storeFields: ["id", "typeId"],
    // Lowercase every indexed term so partial / case-insensitive queries
    // ("linh" vs "Linh Dan") match. MiniSearch's default tokenizer is
    // case-sensitive unless `processTerm` is set.
    processTerm: (term) => term.toLowerCase(),
    searchOptions: {
      prefix: true,
      fuzzy: 0.2,
      // `path` ranks above plain body matches but below the title — a folder
      // hit is a strong relevance signal but shouldn't outrank a literal
      // title match.
      boost: { title: 2, path: 1.5 },
      processTerm: (term) => term.toLowerCase(),
    },
  });
}

/**
 * Tokenize a `filePath` (e.g. `Maison VLM/Courses Leroy Merlin/note.md`) into
 * a search-friendly string by stripping `.md`, splitting on `/`, and joining
 * with spaces so MiniSearch indexes each path segment as its own term.
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
 * are appended to the returned string so MiniSearch indexes them in the
 * `title` field — i.e. "@LD" resolves to a contact whose canonical name
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

function initMiniSearch(db: Database, vaultId: string): void {
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

  const ms = createMiniSearch();
  const docs: EntityDoc[] = allEntities.map((r) => ({
    id: r["id"] as string,
    typeId: r["typeId"] as string,
    title: deriveTitle(r["fields"] as string | null, r["filePath"] as string | null),
    body: (r["body"] as string) ?? "",
    tags: (r["tagPaths"] as string) ?? "",
    path: derivePath(r["filePath"] as string | null),
  }));
  ms.addAll(docs);
  miniSearch = ms;
  console.info("[search] initMiniSearch loaded", docs.length, "docs for vault", vaultId);
}

function miniSearchAdd(entity: EntityDoc): void {
  if (!miniSearch) return;
  try {
    miniSearch.remove({ id: entity.id } as EntityDoc);
  } catch {
    // Not in index yet, that's fine
  }
  miniSearch.add(entity);
  console.info("[search] indexed", entity.id, entity.title);
}

function miniSearchRemove(id: string): void {
  if (!miniSearch) return;
  try {
    miniSearch.remove({ id } as EntityDoc);
  } catch {
    // Not found, ignore
  }
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

export function buildRouter(
  db: Database,
  vaultHandle: FileSystemDirectoryHandle,
  vaultId: string,
): Record<string, RouteHandler> {
  // Populate MiniSearch index on router creation (after DB is ready)
  initMiniSearch(db, vaultId);

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
      miniSearchRemove(id);
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

    // Update MiniSearch index
    miniSearchAdd({
      id,
      typeId,
      title: deriveTitle(JSON.stringify(fields), relativePath),
      body: body ?? "",
      tags: (tags ?? []).join(" "),
      path: derivePath(relativePath),
    });

    return entitiesGet({ id });
  };

  const entitiesUpdate = async (input: unknown): Promise<unknown> => {
    const { id, fields, body, tags, filePath: rawNextPath } = input as {
      id: string;
      fields?: Record<string, unknown>;
      body?: string;
      tags?: string[];
      filePath?: string;
    };
    const ts = now();
    const existing = row(db.exec(
      `SELECT fields, body, filePath, typeId FROM entity WHERE id = ?`, [id],
    ));
    if (!existing) throw new Error(`Entity not found: ${id}`);

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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const canvasFile = await writeExcalidrawSibling(vaultHandle, effectivePath, doc as any);
        if (canvasFile) {
          delete newFields[canvasFieldUpdate.fieldName];
          newFields["canvasFile"] = canvasFile;
        }
      } catch (err) {
        console.warn("[canvas-excalidraw] update: bridge skipped", err);
      }
    }

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
    const hash = await hashContent(content);

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

    db.run(
      `UPDATE entity SET fields = ?, body = ?, fileHash = ?, filePath = ?, updatedAt = ? WHERE id = ?`,
      [JSON.stringify(newFields), newBody, hash, effectivePath, ts, id],
    );

    if (tags !== undefined) {
      db.run(`DELETE FROM entity_tag WHERE entityId = ?`, [id]);
      await applyEntityTags(db, vaultId, id, tags, ts);
    }

    // Update MiniSearch index
    miniSearchAdd({
      id,
      typeId: existing["typeId"] as string,
      title: deriveTitle(JSON.stringify(newFields), effectivePath),
      body: newBody,
      tags: (tags ?? []).join(" "),
      path: derivePath(effectivePath),
    });

    return entitiesGet({ id });
  };

  const entitiesDelete = async (input: unknown): Promise<unknown> => {
    const { id } = input as { id: string };
    const existing = row(db.exec(`SELECT filePath FROM entity WHERE id = ?`, [id]));
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
      miniSearchRemove(id);
    }
    return { id, deleted: true };
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

    if (!miniSearch) return { items: [], total: 0 };

    const matches = miniSearch.search(query.toLowerCase(), {
      prefix: true,
      fuzzy: 0.2,
      processTerm: (term) => term.toLowerCase(),
    });
    const filtered = typeId ? matches.filter((m) => m["typeId"] === typeId) : matches;
    const paged = filtered.slice(0, lim);
    if (!paged.length) return { items: [], total: 0 };

    const ids = paged.map((m) => `'${(m["id"] as string).replace(/'/g, "''")}'`).join(",");
    const entityRows = rows(db.exec(
      `SELECT e.id, e.typeId, et.name as typeName, e.filePath, e.fields, e.body, e.createdAt, e.updatedAt
       FROM entity e
       JOIN entity_type et ON et.id = e.typeId
       WHERE e.id IN (${ids})`,
    ));
    // Preserve MiniSearch ordering (relevance) instead of SQL ordering.
    const byId = new Map(entityRows.map((r) => [r["id"] as string, r]));
    const items = paged
      .map((m) => byId.get(m["id"] as string))
      .filter((r): r is SqlRow => Boolean(r))
      .map(entityRowToApi);
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

  const viewRowToApi = (r: SqlRow): unknown => ({
    id: r["id"],
    typeId: r["typeId"],
    name: r["name"],
    icon: (r["icon"] as string) ?? undefined,
    kind: (r["kind"] as string) ?? "table",
    filters: JSON.parse((r["filters"] as string) || "[]"),
    sorts: JSON.parse((r["sorts"] as string) || "[]"),
    visibleFields: JSON.parse((r["visibleFields"] as string) || "[]"),
    hiddenFields: JSON.parse((r["hiddenFields"] as string) || "[]"),
    groupByField: (r["groupByField"] as string) ?? undefined,
    rowHeight: (r["rowHeight"] as string) ?? "normal",
    isSystem: Boolean(r["isSystem"]),
    createdAt: r["createdAt"],
    updatedAt: r["updatedAt"],
  });

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
      isSystem?: boolean;
    };
    const id = generateId();
    const ts = now();
    db.run(
      `INSERT INTO view (
         id, vaultId, typeId, name, icon, kind,
         filters, sorts, visibleFields, hiddenFields,
         groupByField, rowHeight, isSystem, createdAt, updatedAt
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
    };
    const existing = row(db.exec(`SELECT * FROM view WHERE id = ?`, [id]));
    if (!existing) throw new Error(`View not found: ${id}`);
    const ts = now();

    // Each column is either patched or carried over from the existing row.
    // groupByField is special: callers can pass `null` to clear it, which is
    // different from omitting the field (= keep).
    const next = {
      name: patch.name ?? (existing["name"] as string),
      icon: patch.icon ?? (existing["icon"] as string | null),
      kind: patch.kind ?? (existing["kind"] as string),
      filters: JSON.stringify(
        patch.filters ?? JSON.parse((existing["filters"] as string) || "[]"),
      ),
      sorts: JSON.stringify(
        patch.sorts ?? JSON.parse((existing["sorts"] as string) || "[]"),
      ),
      visibleFields: JSON.stringify(
        patch.visibleFields ??
          JSON.parse((existing["visibleFields"] as string) || "[]"),
      ),
      hiddenFields: JSON.stringify(
        patch.hiddenFields ??
          JSON.parse((existing["hiddenFields"] as string) || "[]"),
      ),
      groupByField:
        patch.groupByField === undefined
          ? (existing["groupByField"] as string | null)
          : patch.groupByField,
      rowHeight: patch.rowHeight ?? (existing["rowHeight"] as string),
    };

    db.run(
      `UPDATE view SET name = ?, icon = ?, kind = ?, filters = ?, sorts = ?,
         visibleFields = ?, hiddenFields = ?, groupByField = ?, rowHeight = ?,
         updatedAt = ? WHERE id = ?`,
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
       WHERE e.vaultId = ? AND e.typeId = ?`,
      [vaultId, inp.typeId],
    )).map(entityRowToApi) as Array<{
      id: string;
      typeId: string;
      filePath: string;
      fields: Record<string, unknown>;
      createdAt: string;
      updatedAt: string;
    }>;

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

    const filtered = allRows.filter((e) =>
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
    // EntityPicker shows something before the user starts typing. We bypass
    // MiniSearch and read from the DB directly because MiniSearch.search("")
    // returns no results.
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

    if (!miniSearch) {
      return { items: [], total: 0, durationMs: 0 };
    }

    const matches = miniSearch.search(query.toLowerCase(), {
      prefix: true,
      fuzzy: 0.2,
      processTerm: (term) => term.toLowerCase(),
    });

    // Filter by typeId if requested, then page
    const filtered = typeId ? matches.filter((m) => m["typeId"] === typeId) : matches;
    const paged = filtered.slice(off, off + lim);

    if (!paged.length) {
      return { items: [], total: filtered.length, durationMs: Date.now() - t0 };
    }

    // Fetch full entity rows for the matched IDs
    const ids = paged.map((m) => `'${(m["id"] as string).replace(/'/g, "''")}'`).join(",");
    const entityRows = rows(db.exec(
      `SELECT e.id, e.typeId, et.name as typeName, e.filePath, e.fields, e.body, e.createdAt, e.updatedAt
       FROM entity e
       JOIN entity_type et ON et.id = e.typeId
       WHERE e.id IN (${ids})`,
    ));

    const entityById = new Map(entityRows.map((r) => [r["id"] as string, r]));
    const items = paged
      .map((m) => {
        const r = entityById.get(m["id"] as string);
        if (!r) return null;
        const body = (r["body"] as string) ?? "";
        const excerpt = body.length > 120 ? body.slice(0, 120) + "..." : body;
        return {
          entityId: r["id"],
          typeId: r["typeId"],
          typeName: r["typeName"],
          filePath: r["filePath"],
          title: deriveTitle(r["fields"] as string | null, r["filePath"] as string | null),
          excerpts: excerpt ? [excerpt] : [],
          score: Math.min(1, (m.score as number) / 10),
          semantic: false,
          tags: [],
        };
      })
      .filter(Boolean);

    return { items, total: filtered.length, durationMs: Date.now() - t0 };
  };

  // ── reindex ───────────────────────────────────────────────────────────────

  const reindexVault = async (): Promise<{ indexed: number }> => {
    const files = await walkMarkdownFiles(vaultHandle);
    let indexed = 0;
    for (const file of files) {
      try {
        const { frontmatter, body } = parseFrontmatter(file.content);
        const entityId = frontmatter["id"] as string | undefined;
        if (!entityId) continue;
        const typeName = frontmatter["type"] as string | undefined;
        if (!typeName) continue;
        const typeRow = row(db.exec(
          `SELECT id FROM entity_type WHERE vaultId = ? AND name = ?`, [vaultId, typeName],
        ));
        if (!typeRow) continue;
        const typeId = typeRow["id"] as string;
        // Fields are stored as TOP-LEVEL YAML keys (everything except the
        // reserved `id` / `type` keys). For backward-compat with the old
        // format that used a nested `fields: {...}` JSON blob, fall back
        // to that when no top-level user keys are present, and merge top-
        // level keys on top of it (top-level wins) when both exist.
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
          // Parser fell back to raw string — try to recover the JSON.
          try {
            const parsed = JSON.parse(nestedRaw);
            if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
              nestedFields = parsed as Record<string, unknown>;
            }
          } catch {
            // Give up; nested stays empty.
          }
        }
        const fields = { ...nestedFields, ...topLevelFields };
        const hash = await hashContent(file.content);
        const ts = now();
        db.run(
          `INSERT INTO entity (id, vaultId, typeId, filePath, fields, body, fileHash, createdAt, updatedAt)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             filePath = excluded.filePath, fields = excluded.fields,
             body = excluded.body, fileHash = excluded.fileHash, updatedAt = excluded.updatedAt`,
          [entityId, vaultId, typeId, file.relativePath, JSON.stringify(fields), body, hash, ts, ts],
        );

        // Update MiniSearch
        const r = row(db.exec(`SELECT id, typeId, filePath, fields, body FROM entity WHERE id = ?`, [entityId]));
        if (r) miniSearchAdd(entityToDoc(r));

        indexed++;
      } catch {
        // Skip unparseable files
      }
    }

    // Rebuild full index after reindex to stay in sync
    if (indexed > 0) {
      initMiniSearch(db, vaultId);
    }

    return { indexed };
  };

  // ── system.* ──────────────────────────────────────────────────────────────

  const systemGetAppInfo = async (): Promise<unknown> => ({
    version: "0.0.0-pwa",
    platform: "browser",
    userDataPath: "",
    vaultPath: "",
  });

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
    "entities.getRelated": entitiesGetRelated,
    "entities.getBacklinks": entitiesGetBacklinks,

    "schemas.list": schemasList,
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
