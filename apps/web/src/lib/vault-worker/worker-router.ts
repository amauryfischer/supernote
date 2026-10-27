/**
 * worker-router — handles tRPC-style route dispatch inside the vault web worker.
 *
 * Implements the same procedure surface as the Electron main process:
 * vault.*, entities.*, schemas.*, tags.*, search.*
 *
 * Drives sqlite-wasm directly (no Prisma) and FSA for file I/O. Full-text
 * search uses the SQLite FTS5 module (shipped by `@sqlite.org/sqlite-wasm`)
 * with manually managed `entity_fts` rows — see `ftsAdd` / `ftsRemove` /
 * `ftsRebuild` in ./entity-helpers.
 */

import type { Database } from "./sqlite-adapter";
import { row, rows, runInTransaction, type SqlValue, type SqlRow } from "./sql";
import { buildCalendarRoutes } from "./calendar-routes";
import { buildChecklistRoutes } from "./checklists";
import { buildMailRoutes } from "./mail-routes";
import { buildSyncRoutes } from "./sync-routes";
import {
  now,
  buildFtsMatch,
  ftsAdd,
  ftsRemove,
  tombstoneAdd,
  tombstoneClear,
  isTombstoned,
  ftsRebuild,
  entityToDoc,
  indexMentions,
  mentionsRemove,
  mentionsRebuild,
  deriveTitle,
  parseTypeFieldsBlob,
  safeParseFieldsBlob,
  applyEntityTags,
} from "./entity-helpers";
import {
  parseFrontmatter,
  serializeFrontmatter,
  walkAllFiles,
  isMarkdownExt,
  isExcalidrawExt,
  isAttachmentExt,
  writeVaultFile,
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
import { VariableInputSchema, type TemplateIpc, type SaveTemplateInput } from "@supernote/ipc";
import {
  listVariables,
  getVariable,
  insertVariable,
  updateVariable,
  deleteVariable,
  makeVariableResolver,
  buildVaultFormulaContext,
} from "./variables";
import { isMountedPath } from "./mount-provenance";
import { resolveFileNameStem } from "./entity-filename";
import { decodeTagPaths } from "./tag-paths";
import { sanitizePath, stripPathSlashes, sanitizeFolderPath, derivePath } from "./path-utils";
import { TEMPLATE_TYPE_ID, TEMPLATE_FOLDER, TEMPLATE_SEED_TS } from "./seed-default-types";
import { SEED_TEMPLATES } from "@supernote/templates/seeds";


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

  // Backfill de l'index de mentions (backlinks) : rebuild complet une seule
  // fois par version du scanner, repérée par un marqueur dans `setting`. Sans
  // lui, un index construit par un ancien scanner (v1 : @mentions multi-mots
  // ou accentuées jamais résolues) resterait faux jusqu'à la réécriture de
  // chaque note. Ensuite create/update/delete l'entretiennent. Une seule
  // transaction pour tout le batch (un commit OPFS au lieu d'un par statement).
  try {
    const versionKey = "system.mentions.indexVersion";
    const indexVersion = "2";
    const stored = row(db.exec(
      `SELECT value FROM setting WHERE vaultId = ? AND key = ?`,
      [vaultId, versionKey],
    ))?.["value"];
    if (stored !== indexVersion) {
      const scanned = runInTransaction(db, () => {
        const n = mentionsRebuild(db, vaultId);
        const ts = now();
        db.run(
          `INSERT OR REPLACE INTO setting (id, vaultId, key, value, createdAt, updatedAt)
            VALUES (?, ?, ?, ?, ?, ?)`,
          [`${vaultId}:${versionKey}`, vaultId, versionKey, indexVersion, ts, ts],
        );
        return n;
      });
      console.info(`[backlinks] mention backfill v${indexVersion}: scanned ${scanned} entit(y/ies) with links`);
    }
  } catch (err) {
    console.warn("[backlinks] mention backfill failed (non-fatal)", err);
  }

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
  const runSerialized = <T>(key: string, fn: () => Promise<T>): Promise<T> => {
    const prev = entityWriteChains.get(key) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    // Swallow rejections so a single failed update doesn't poison the chain
    // for every subsequent save on the same entity.
    const settled = next.then(
      () => undefined,
      () => undefined,
    );
    entityWriteChains.set(key, settled);
    // Purge une fois la chaîne retombée au repos — et seulement si personne ne
    // s'y est enchaîné depuis. Les clés `path:` en créent une par chemin de
    // destination : sans ça, un tri d'inbox laissait une entrée par note rangée.
    void settled.then(() => {
      if (entityWriteChains.get(key) === settled) entityWriteChains.delete(key);
    });
    return next;
  };

  /**
   * Existence d'un fichier dans le coffre, sans le lire. `getFileHandle` suffit
   * pour répondre oui/non ; `readVaultFile` matérialiserait tout le contenu.
   */
  const fileExistsAt = async (path: string): Promise<boolean> => {
    const segments = path.split("/");
    const name = segments[segments.length - 1];
    if (!name) return false;
    try {
      let dir: FileSystemDirectoryHandle = vaultHandle;
      for (const seg of segments.slice(0, -1)) {
        dir = await dir.getDirectoryHandle(seg);
      }
      await dir.getFileHandle(name);
      return true;
    } catch (err) {
      // Seul « ça n'existe pas » signifie « libre ». Un dossier nommé `x.md`
      // (TypeMismatchError) ou un handle FSA périmé (NotAllowedError) répondaient
      // « libre » eux aussi, c'est-à-dire l'autorisation d'écraser à l'aveugle.
      if ((err as DOMException)?.name === "NotFoundError") return false;
      throw err;
    }
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
    "Tags",
    "Finance",
    "Canvas",
    "Routines",
    "Todos",
    TEMPLATE_FOLDER,
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

  // `_attachments` : dossier technique des pièces jointes collées dans les
  // notes. Jamais remonté comme dossier du coffre (arbre, destinations de
  // déplacement) — le fichier reste lisible par son chemin.
  const ATTACHMENTS_SEGMENT = "_attachments";

  function derivedFolders(): string[] {
    const r = rows(db.exec(
      `SELECT filePath FROM entity WHERE vaultId = ?`, [vaultId],
    ));
    const out = new Set<string>();
    for (const e of r) {
      const fp = (e["filePath"] as string) ?? "";
      const parts = fp.split("/");
      if (parts.includes(ATTACHMENTS_SEGMENT)) continue;
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
      const previous = await entitiesGet({ id: r["id"] as string }).catch(() => null);
      db.run(
        `UPDATE entity SET filePath = ?, updatedAt = ? WHERE id = ?`,
        [newFilePath, ts, r["id"] as string],
      );
      // Sans le hook, aucune op de synchro : les autres appareils gardaient l'ancien dossier.
      try { hooks.onEntityUpdated?.(await entitiesGet({ id: r["id"] as string }), previous); } catch (e) { console.warn("[hook] onEntityUpdated", e); }
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
      const previous = await entitiesGet({ id }).catch(() => null);
      try {
        await deleteVaultFile(vaultHandle, filePath.split("/"));
      } catch {
        // File may already be gone; keep going so the DB stays consistent.
      }
      db.run(`DELETE FROM entity WHERE id = ?`, [id]);
      ftsRemove(db, id);
      mentionsRemove(db, id);
      tombstoneAdd(db, id); // block reindex resurrection if the .md survived
      try { hooks.onEntityDeleted?.(id, previous); } catch (e) { console.warn("[hook] onEntityDeleted", e); }
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
    // total honore le même filtre typeId/typeName que la liste (avant : COUNT du
    // vault entier, donc un total faux dès qu'on filtrait par type).
    const total = countEntities(inp.typeId, inp.typeName);
    return { items, total };
  };

  // COUNT pur, filtre type optionnel. Aucune entité transportée.
  const countEntities = (typeId?: string, typeName?: string): number => {
    let sql = `SELECT COUNT(*) as c FROM entity e`;
    if (typeName) sql += ` JOIN entity_type et ON et.id = e.typeId`;
    sql += ` WHERE e.vaultId = ?`;
    const params: SqlValue[] = [vaultId];
    if (typeId) { sql += ` AND e.typeId = ?`; params.push(typeId); }
    if (typeName) { sql += ` AND et.name = ?`; params.push(typeName); }
    return (row(db.exec(sql, params))?.["c"] ?? 0) as number;
  };

  const entitiesCount = async (input: unknown): Promise<unknown> => {
    const inp = (input ?? {}) as { typeId?: string; typeName?: string };
    return { count: countEntities(inp.typeId, inp.typeName) };
  };

  // Comme entitiesList mais ne renvoie qu'un extrait de corps (240 car.) au lieu
  // du markdown complet : les surfaces read-only (widgets accueil, nuage de tags)
  // n'ont besoin que des champs/aperçu, pas du body entier cloné pour 10 000 lignes.
  const entitiesListSummaries = async (input: unknown): Promise<unknown> => {
    const inp = (input ?? {}) as {
      typeId?: string;
      typeName?: string;
      limit?: number;
      offset?: number;
    };
    const limit = inp.limit ?? 50;
    const offset = inp.offset ?? 0;
    let sql = `
      SELECT e.id, e.typeId, et.name as typeName, e.filePath, e.fields,
             substr(e.body, 1, 240) as body,
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
    return { items, total: countEntities(inp.typeId, inp.typeName) };
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

  // Descendants par `fields.parentId`, limités aux notes du dossier de la racine :
  // une sous-page rangée ailleurs reste où elle est.
  const entitiesSubpageDescendants = async (input: unknown): Promise<unknown> => {
    const { id } = input as { id: string };
    const root = row(db.exec(`SELECT filePath FROM entity WHERE id = ? AND vaultId = ?`, [id, vaultId]));
    if (!root) throw new Error(`Entity not found: ${id}`);
    const folderOf = (p: string): string => p.slice(0, Math.max(0, p.lastIndexOf("/")));
    const rootFolder = folderOf(root["filePath"] as string);
    const childrenOf = new Map<string, { id: string; filePath: string }[]>();
    for (const r of rows(db.exec(
      `SELECT id, filePath, json_extract(fields, '$.parentId') AS parentId
         FROM entity
        WHERE vaultId = ? AND typeId = 'note' AND json_extract(fields, '$.parentId') IS NOT NULL`,
      [vaultId],
    ))) {
      const filePath = r["filePath"] as string;
      if (folderOf(filePath) !== rootFolder) continue;
      const parentId = String(r["parentId"]);
      const list = childrenOf.get(parentId) ?? [];
      list.push({ id: r["id"] as string, filePath });
      childrenOf.set(parentId, list);
    }
    const visited = new Set<string>([id]);
    const items: { id: string; filePath: string }[] = [];
    for (let queue = [id]; queue.length > 0; ) {
      const next: string[] = [];
      for (const parent of queue) {
        for (const child of childrenOf.get(parent) ?? []) {
          if (visited.has(child.id)) continue;
          visited.add(child.id);
          items.push(child);
          next.push(child.id);
        }
      }
      queue = next;
    }
    return { items };
  };

  const entitiesGet = async (input: unknown): Promise<unknown> => {
    const { id } = input as { id: string };
    const r = row(db.exec(
      `SELECT e.id, e.typeId, et.name as typeName, et.fields as typeFields, e.filePath, e.fields, e.body, e.sourceVaultId, e.createdAt, e.updatedAt,
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
      typeFields?: unknown[];
    };
    // Carry the type's column defs so the online-sync `ENTITY_CHANGE` op can
    // transport them (a receiver recreates an unknown custom base WITH columns).
    api.typeFields = parseTypeFieldsBlob(r["typeFields"]);
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
    const { typeId, fields, body, tags, id: restoreId } = input as {
      typeId: string;
      fields: Record<string, unknown>;
      body?: string;
      tags?: string[];
      id?: string;
    };
    // Annulation d'une suppression : reprendre l'id d'origine garde valides les
    // relations des autres entités, qui le référencent encore dans leurs champs.
    const id =
      typeof restoreId === "string" && restoreId && !row(db.exec(`SELECT 1 FROM entity WHERE id = ?`, [restoreId]))
        ? restoreId
        : generateId();
    const ts = now();
    const typeRow = row(db.exec(`SELECT name, defaultPath, fileNamePattern, fields FROM entity_type WHERE id = ?`, [typeId]));
    if (!typeRow) throw new Error(`EntityType not found: ${typeId}`);

    // Applique les valeurs par défaut déclarées au schéma pour chaque champ
    // absent du payload — une nouvelle ligne hérite des defaults (façon Notion).
    // Les valeurs d'entité sont indexées par `id` de champ, pas par `name`.
    try {
      const defs = JSON.parse((typeRow["fields"] as string) || "[]") as Array<{
        id?: string;
        name?: string;
        defaultValue?: unknown;
      }>;
      for (const def of defs) {
        const key = def?.id || def?.name;
        if (key && def.defaultValue !== undefined && fields[key] === undefined) {
          fields[key] = def.defaultValue;
        }
      }
    } catch {
      /* schéma sans defaults exploitables — on ignore */
    }

    // Determine file path. Caller can pass `fields.filePath` (already a
    // full relative path like "Inbox/nouvelle-note.md") — that wins over
    // the type's `defaultPath`. We sanitize then strip `fields.filePath`
    // so it's not double-stored in the JSON blob.
    const requestedFullPath = typeof fields["filePath"] === "string"
      ? sanitizePath(fields["filePath"] as string)
      : "";
    let relativePath: string;
    if (requestedFullPath) {
      relativePath = requestedFullPath.endsWith(".md")
        ? requestedFullPath
        : `${requestedFullPath}/${id}.md`;
      delete fields["filePath"];
    } else {
      // Derive the filename from the type's fileNamePattern (e.g. note →
      // "{title}") so the on-disk file — and any Drive/iCloud/GitHub mirror —
      // is named after the entity's title, not its ULID. Empty title → fall
      // back to the id so the path stays unique.
      const stem =
        resolveFileNameStem(
          (typeRow["fileNamePattern"] as string) ?? "",
          fields,
          id,
          ts,
        ) || id;
      const fileName = `${stem}.md`;
      const dir = stripPathSlashes((typeRow["defaultPath"] as string) ?? "");
      relativePath = dir ? `${dir}/${fileName}` : fileName;
    }

    // Suffix on conflict: if a note with the same filePath already exists in
    // this vault, append "-2", "-3", … until we find a free slot. Without this,
    // creating a second "Nouvelle note" in a folder that already has one
    // throws `UNIQUE constraint failed: entity.vaultId, entity.filePath`.
    //
    // ⚠️ Le disque compte autant que la base. Un `.md` orphelin — déposé à la
    // main, laissé par une synchro — n'a pas de ligne `entity`, donc `existsAt`
    // ne le voit pas et `writeVaultFile` l'écrasait SANS lever : contenu perdu,
    // en silence, sur le chemin le plus fréquent de l'application. Un orphelin
    // fait passer au suffixe suivant, comme une ligne en base : ce n'est pas
    // une erreur de l'utilisateur, juste un nom déjà pris.
    const existsAt = (p: string): boolean => {
      const r = row(db.exec(
        `SELECT 1 FROM entity WHERE vaultId = ? AND filePath = ? LIMIT 1`,
        [vaultId, p],
      ));
      return !!r;
    };
    const takenAt = async (p: string): Promise<boolean> =>
      existsAt(p) || (await fileExistsAt(p));
    // Clé de sérialisation : le chemin AVANT suffixage, seul point commun à deux
    // créations concurrentes visant le même nom. Sans elle, elles résolvent
    // toutes deux le même chemin libre et la seconde écrase la première.
    const createLockKey = `path:${relativePath}`;

    const resolveAndWrite = async (): Promise<void> => {
      if (await takenAt(relativePath)) {
        const dotIdx = relativePath.lastIndexOf(".");
        const stem = dotIdx > 0 ? relativePath.slice(0, dotIdx) : relativePath;
        const ext = dotIdx > 0 ? relativePath.slice(dotIdx) : "";
        let suffix = 2;
        let candidate = `${stem}-${suffix}${ext}`;
        while ((await takenAt(candidate)) && suffix < 9999) {
          suffix++;
          candidate = `${stem}-${suffix}${ext}`;
        }
        relativePath = candidate;
      }

      // Read-only mount guard (defense in depth): a native create whose resolved
      // path lands under `@mounts/<slug>/…` would be mis-classified as native
      // (sourceVaultId NULL) → file written to the PARENT disk + pushed to the
      // PARENT room (cross-vault contamination). Mounted subtrees are structurally
      // read-only in V1, so reject the create before any disk write or INSERT.
      if (isMountedPath(relativePath)) {
        throw new Error("Lecture seule : impossible de créer une note dans un vault monté.");
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

      // Une seule transaction : sans elle, une levée après l'INSERT laissait une
      // entité sans FTS/tags/mentions alors que l'appelant recevait une erreur.
      // L'INSERT reste sous le verrou `path:` (apparié à la contrainte UNIQUE).
      runInTransaction(db, () => {
        db.run(
          `INSERT INTO entity (id, vaultId, typeId, filePath, fields, body, fileHash, createdAt, updatedAt)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [id, vaultId, typeId, relativePath, JSON.stringify(fields), body ?? "", "", ts, ts],
        );
        // (Re)creating this id supersedes any prior deletion — clear its tombstone
        // so the reindex stops skipping its file.
        tombstoneClear(db, id);
        if (tags?.length) applyEntityTags(db, vaultId, id, tags, ts);
        ftsAdd(db, {
          id,
          typeId,
          title: deriveTitle(JSON.stringify(fields), relativePath),
          body: body ?? "",
          tags: (tags ?? []).join(" "),
          path: derivePath(relativePath),
        });
        indexMentions(db, vaultId, id, body ?? "");
      });
    };

    await runSerialized(createLockKey, resolveAndWrite);

    const created = await entitiesGet({ id });
    try { hooks.onEntityCreated?.(created); } catch (e) { console.warn("[hook] onEntityCreated", e); }
    return created;
  };

  const entitiesUpdate = async (input: unknown): Promise<unknown> => {
    const { id, fields, body, tags, filePath: rawNextPath, __skipInverseSync: skipInverseSync } = input as {
      id: string;
      fields?: Record<string, unknown>;
      body?: string;
      tags?: string[];
      filePath?: string;
      // Garde anti-récursion : posé quand on met à jour le champ inverse d'une
      // relation pour éviter le ping-pong A↔B.
      __skipInverseSync?: boolean;
    };
    return runSerialized(id, async () => {
    const ts = now();
    const existing = row(db.exec(
      `SELECT fields, body, filePath, typeId, sourceVaultId FROM entity WHERE id = ?`, [id],
    ));
    if (!existing) throw new Error(`Entity not found: ${id}`);
    // Provenance gate: a mounted entity (sourceVaultId non-null) lives under
    // `@mounts/<slug>/…` in the PARENT db but must NEVER materialize a file in
    // the parent's FSA folder, nor be pushed to the parent's room. We update the
    // DB row in place and skip every disk side-effect. The ENTITY_CHANGE emit
    // already carries this provenance (entitiesGet selects sourceVaultId), so the
    // edit routes to the mount room. See `syncApplyOps` which guards the same way.
    const provenance = (existing["sourceVaultId"] as string | null) ?? null;
    const previousForHook = await entitiesGet({ id }).catch(() => null);

    // Defensive parse: strips character-index keys from prior corruption
    // and deep-unescapes string values. See safeParseFieldsBlob for details.
    const existingFields = safeParseFieldsBlob((existing["fields"] as string) || "{}");
    const newFields = fields ? { ...existingFields, ...fields } : existingFields;
    const newBody = body ?? (existing["body"] as string) ?? "";

    // ── Relations bidirectionnelles (best-effort, gardé) ──────────────────
    // Quand un champ relation change ET qu'un champ relation inverse apparié
    // (même relationTypeId, cible = type courant) existe côté cible, on reflète
    // l'ajout/retrait sur ce champ inverse. No-op si pas d'appariement explicite
    // → zéro impact sur les bases sans relations bidi. `__skipInverseSync`
    // empêche le ping-pong A↔B. Jouée APRÈS le commit de la source (chaque cible
    // réécrit son .md : I/O, donc hors transaction) : une source qui lève ne
    // laisse plus de demi-relation côté cibles.
    const syncInverseRelations = async (): Promise<void> => {
      if (!fields || skipInverseSync) return;
      try {
        const parseIds = (v: unknown): string[] => {
          if (!v) return [];
          if (Array.isArray(v)) return v.map(String).filter(Boolean);
          if (typeof v === "string") {
            if (v.startsWith("[")) { try { return (JSON.parse(v) as unknown[]).map(String).filter(Boolean); } catch { /* */ } }
            return v ? [v] : [];
          }
          return [];
        };
        type RelDef = { id?: string; kind?: string; type?: string; targetTypeId?: string; relationTypeId?: string };
        const typeFieldsOf = (tid: string): RelDef[] => {
          const tr = row(db.exec(`SELECT fields FROM entity_type WHERE id = ?`, [tid]));
          try { return JSON.parse((tr?.["fields"] as string) || "[]") as RelDef[]; } catch { return []; }
        };
        const myTypeId = existing["typeId"] as string;
        for (const f of typeFieldsOf(myTypeId)) {
          if ((f.type ?? f.kind) !== "relation" || !f.id || !f.relationTypeId || !f.targetTypeId) continue;
          if (!(f.id in fields)) continue;
          const before = new Set(parseIds(existingFields[f.id]));
          const after = new Set(parseIds(newFields[f.id]));
          const added = [...after].filter((x) => !before.has(x));
          const removed = [...before].filter((x) => !after.has(x));
          if (added.length === 0 && removed.length === 0) continue;
          const inverse = typeFieldsOf(f.targetTypeId).find(
            (g) => (g.type ?? g.kind) === "relation" && g.relationTypeId === f.relationTypeId && g.targetTypeId === myTypeId && g.id,
          );
          if (!inverse?.id) continue;
          const invId = inverse.id;
          const applyTo = async (targetId: string, add: boolean) => {
            // Auto-référence : éviter le re-lock runSerialized(id) → deadlock.
            if (targetId === id) return;
            const tr = row(db.exec(`SELECT fields FROM entity WHERE id = ? AND vaultId = ?`, [targetId, vaultId]));
            if (!tr) return;
            const tf = safeParseFieldsBlob((tr["fields"] as string) || "{}");
            const cur = new Set(parseIds(tf[invId]));
            if (add) cur.add(id); else cur.delete(id);
            await entitiesUpdate({ id: targetId, fields: { [invId]: [...cur] }, __skipInverseSync: true });
          };
          for (const x of added) await applyTo(x, true);
          for (const x of removed) await applyTo(x, false);
        }
      } catch (err) {
        console.warn("[relations] sync inverse échouée", err);
      }
    };

    const oldPath = (existing["filePath"] as string) ?? "";
    // Normalize the requested path: strip ".." segments and leading/trailing
    // slashes so a malicious caller can't escape the vault root.
    const cleanedNextPath =
      typeof rawNextPath === "string" ? sanitizePath(rawNextPath) : "";
    let isMove = cleanedNextPath.length > 0 && cleanedNextPath !== oldPath;
    let effectivePath = isMove ? cleanedNextPath : oldPath;

    // Read-only mount structure (V1): a mounted entity (sourceVaultId non-null)
    // must NOT be moved out of its `@mounts/<slug>/…` prefix. A path-change here
    // would rewrite the DB filePath off the prefix while keeping the provenance,
    // producing an ENTITY_CHANGE op with a bare native path that gets pushed into
    // the SOURCE mount room — corrupting it. Content/fields edits stay allowed.
    if (provenance !== null && isMove) {
      throw new Error("Lecture seule : impossible de déplacer une note d'un vault monté.");
    }

    // Garde de DESTINATION, miroir de celle d'entitiesCreate : une entité
    // native déplacée sous `@mounts/<slug>/…` garderait `sourceVaultId NULL`,
    // donc son op partirait dans le salon du PÈRE avec un chemin monté —
    // contamination inter-coffres. La provenance ci-dessus ne couvre que le
    // sens inverse (sortir une entité montée).
    if (isMove && provenance === null && isMountedPath(effectivePath)) {
      throw new Error(
        "Destination interdite : un sous-arbre monté est en lecture seule.",
      );
    }

    /** Vrai si une AUTRE entité occupe déjà ce chemin dans ce coffre. */
    const pathTakenByOther = (p: string): boolean => {
      const r = row(db.exec(
        `SELECT id FROM entity WHERE vaultId = ? AND filePath = ? LIMIT 1`,
        [vaultId, p],
      ));
      return !!r && (r["id"] as string) !== id;
    };

    // ⚠️ Le déplacement écrit le fichier destination AVANT de supprimer la
    // source, et l'UPDATE ne lève qu'ensuite sur `entity_vaultId_filePath_key`.
    // Sans ce test, une collision détruisait DEUX notes : l'occupant (écrasé
    // par le contenu entrant) et la déplacée (fichier source supprimé, ligne
    // orpheline balayée en phantom au démarrage suivant). On refuse avant la
    // moindre écriture. `entities.moveIfFree` suffixe plutôt que de refuser.
    if (isMove && pathTakenByOther(effectivePath)) {
      throw new Error(`Un fichier existe déjà à ${effectivePath}.`);
    }

    // Title-driven auto-rename. Keep the on-disk filename — and therefore the
    // name shown by any folder-sync (Google Drive, iCloud, GitHub) — in step
    // with the entity's title. We only act when the caller did NOT request an
    // explicit move, the entity isn't a mounted read-only one, and the current
    // file is a markdown note. The new stem comes from the type's
    // fileNamePattern; if it differs from the current filename we promote the
    // edit to a move so the write-new/delete-old machinery below renames the
    // file. The directory is preserved; a collision — autre entité en base ou
    // `.md` orphelin sur le disque — passe au suffixe `-N`, comme entitiesCreate.
    if (
      !isMove &&
      provenance === null &&
      fields !== undefined &&
      oldPath.toLowerCase().endsWith(".md")
    ) {
      const typeMeta = row(db.exec(
        `SELECT fileNamePattern FROM entity_type WHERE id = ?`,
        [existing["typeId"] ?? null],
      ));
      const pattern = (typeMeta?.["fileNamePattern"] as string) ?? "";
      const stem = pattern ? resolveFileNameStem(pattern, newFields, id, ts) : "";
      if (stem) {
        const slash = oldPath.lastIndexOf("/");
        const dir = slash >= 0 ? oldPath.slice(0, slash) : "";
        const build = (s: string): string => (dir ? `${dir}/${s}.md` : `${s}.md`);
        const takenByOther = async (p: string): Promise<boolean> => {
          const r = row(db.exec(
            `SELECT id FROM entity WHERE vaultId = ? AND filePath = ? LIMIT 1`,
            [vaultId, p],
          ));
          if (!!r && (r["id"] as string) !== id) return true;
          // Le disque compte autant que la base : un `.md` orphelin ferait lever
          // `commitWrite` plus bas, et tout l'UPDATE — titre ET corps en cours
          // d'édition — partirait avec. `oldPath` est notre propre fichier.
          return p !== oldPath && (await fileExistsAt(p));
        };
        let candidate = build(stem);
        if (candidate !== oldPath && (await takenByOther(candidate))) {
          let n = 2;
          while ((await takenByOther(build(`${stem}-${n}`))) && n < 9999) n++;
          candidate = build(`${stem}-${n}`);
        }
        if (candidate !== oldPath && !isMountedPath(candidate)) {
          effectivePath = candidate;
          isMove = true;
        }
      }
    }

    // Canvas split on update: mirrors entitiesCreate. If the incoming
    // fields carry a fresh canvas JSON, write it to the sibling and
    // replace with a canvasFile pointer.
    const canvasFieldUpdate = extractCanvasField(newFields);
    if (canvasFieldUpdate && provenance === null) {
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
    /** Suppression du fichier source, jouée seulement une fois l'UPDATE passé. */
    let cleanupSource: (() => Promise<void>) | null = null;
    /**
     * Écriture du fichier + UPDATE de la ligne. Sérialisé sur le chemin de
     * DESTINATION quand c'est un déplacement : `runSerialized` est clé par id,
     * donc deux entités différentes visant le même chemin libre franchissaient
     * toutes les deux le test d'occupation, écrivaient toutes les deux, et la
     * seconde écrasait le contenu de la première. Rien d'autre ne prend de
     * verrou `path:` — l'ordre d'acquisition reste id → path, pas d'interblocage.
     */
    const commitWrite = async (): Promise<void> => {
      if (provenance !== null) {
        // Mounted entity: persist DB-only. NO file write, NO move/delete on the
        // parent FSA — those bytes belong to the mount room, not the parent disk.
        // `fileHash` stays "" because there is no parent-side file to hash.
        hash = "";
      } else if (!isAttachmentEntity) {
        // Rewrite the .md file
        const typeRow = row(db.exec(`SELECT name FROM entity_type WHERE id = ?`, [existing["typeId"] ?? null]));
        // See entitiesCreate: top-level keys, no nested `fields:` blob.
        const frontmatter: Record<string, unknown> = {
          id,
          type: typeRow?.["name"] ?? "",
          ...newFields,
        };
        const content = serializeFrontmatter(frontmatter, newBody);
        // Un déplacement n'écrase JAMAIS un fichier existant : la base ne voit pas
        // les .md orphelins, ni le fichier qu'un déplacement concurrent vient
        // d'écrire (le test SQL des deux a eu lieu quand le chemin était libre).
        if (isMove && (await fileExistsAt(effectivePath))) {
          throw new Error(`Un fichier existe déjà à ${effectivePath}.`);
        }
        await writeVaultFile(vaultHandle, effectivePath.split("/"), content);
        hash = await hashContent(content);

        if (isMove) {
          // ⚠️ La suppression de la source est différée APRÈS l'UPDATE : la
          // contrainte d'unicité est le seul arbitre réellement atomique, et
          // `runSerialized` est clé par id — deux entités différentes visant le
          // même chemin libre ne sont pas sérialisées entre elles. Supprimer
          // avant l'UPDATE laissait la perdante sans fichier ET sans ligne
          // cohérente. Dans cet ordre, une levée coûte au pire un doublon.
          cleanupSource = async () => {
            try {
              await deleteVaultFile(vaultHandle, oldPath.split("/"));
            } catch {
              // Old file may already be gone (e.g. concurrent move) — best-effort.
            }
            // Move the .excalidraw sibling alongside the .md (best-effort).
            await moveExcalidrawSibling(vaultHandle, oldPath, effectivePath);
          };
        }
      } else if (isMove) {
        // Attachment rename: move the underlying attachment file itself.
        // We don't go through writeVaultFile — that writes markdown.
        console.info(
          `[entitiesUpdate] attachment rename ${oldPath} → ${effectivePath} (binary move not implemented; SQL row updated, disk file left at old path)`,
        );
      }

      // Une seule transaction : le DELETE entity_tag commité seul puis une levée
      // dans applyEntityTags perdait les tags pour toujours (rien ne les reconstruit).
      runInTransaction(db, () => {
        db.run(
          `UPDATE entity SET fields = ?, body = ?, fileHash = ?, filePath = ?, updatedAt = ? WHERE id = ?`,
          [JSON.stringify(newFields), newBody, hash, effectivePath, ts, id],
        );
        tombstoneClear(db, id); // a live, edited entity is not a tombstone

        if (tags !== undefined) {
          db.run(`DELETE FROM entity_tag WHERE entityId = ?`, [id]);
          applyEntityTags(db, vaultId, id, tags, ts);
        }

        // Relire les tags depuis entity_tag (paths, comme ftsRebuild) plutôt que de
        // se fier au param `tags` : une update de corps/champs sans `tags` réécrivait
        // la colonne FTS avec "" et cassait silencieusement la recherche par tag en
        // session (réparée seulement au ftsRebuild du boot suivant). applyEntityTags
        // a déjà mis entity_tag à jour au-dessus quand `tags` était fourni.
        const ftsTags =
          (row(
            db.exec(
              `SELECT GROUP_CONCAT(t.path, ' ') as tp
                 FROM entity_tag et JOIN tag t ON t.id = et.tagId
                WHERE et.entityId = ?`,
              [id],
            ),
          )?.["tp"] as string) ?? "";

        ftsAdd(db, {
          id,
          typeId: existing["typeId"] as string,
          title: deriveTitle(JSON.stringify(newFields), effectivePath),
          body: newBody,
          tags: ftsTags,
          path: derivePath(effectivePath),
        });
        indexMentions(db, vaultId, id, newBody);
      });
      // La ligne porte le nouveau chemin : la source peut partir sans risque.
      if (cleanupSource) await cleanupSource();
    };

    if (isMove) await runSerialized(`path:${effectivePath}`, commitWrite);
    else await commitWrite();

    await syncInverseRelations();

    const updated = await entitiesGet({ id });
    try { hooks.onEntityUpdated?.(updated, previousForHook); } catch (e) { console.warn("[hook] onEntityUpdated", e); }
    return updated;
    });
  };

  /**
   * Déplace une entité dans un dossier en résolvant le premier nom de fichier
   * LIBRE (`-2`, `-3`, … jusqu'à 9999, la politique d'entitiesCreate) au lieu
   * d'écraser ou d'échouer. `folder: "."` désigne la racine du coffre.
   *
   * Le test d'occupation vit ici, pas chez l'appelant : côté client il serait
   * non atomique (des minutes entre le scan et l'écriture, une sync distante
   * ou une création à la souris suffisant à le périmer). Ici il est synchrone
   * avec la base, juste avant l'écriture. Il ne remplace pas la contrainte
   * d'unicité — c'est elle qui arbitre deux écritures concurrentes, et
   * `entitiesUpdate` ne supprime la source qu'une fois l'UPDATE passé.
   *
   * Le disque est consulté en plus de la base : un .md orphelin (présent sans
   * ligne `entity`) serait écrasé par `writeVaultFile` SANS lever.
   */
  const entitiesMoveIfFree = async (input: unknown): Promise<unknown> => {
    const { id, folder } = input as { id: string; folder: string };
    const existing = row(db.exec(
      `SELECT filePath, sourceVaultId FROM entity WHERE id = ? AND vaultId = ?`,
      [id, vaultId],
    ));
    if (!existing) throw new Error(`Entity not found: ${id}`);
    // Une entité montée est en lecture seule : le dire avant de dépenser une
    // résolution de nom (et ses lectures disque) pour rien.
    if (((existing["sourceVaultId"] as string | null) ?? null) !== null) {
      throw new Error("Lecture seule : impossible de déplacer une note d'un vault monté.");
    }
    const oldPath = (existing["filePath"] as string) ?? "";
    // "." = racine du coffre. Sans ça, une note qui vivait à la racine ne
    // pouvait pas y revenir (annulation d'un rangement).
    const cleanFolder = folder === "." ? "" : sanitizePath(folder);
    if (folder !== "." && !cleanFolder) {
      throw new Error("Dossier de destination vide.");
    }
    if (/\.[a-z0-9]+$/i.test(cleanFolder)) {
      throw new Error(`« ${cleanFolder} » est un fichier, pas un dossier.`);
    }
    if (cleanFolder && isMountedPath(`${cleanFolder}/x`)) {
      throw new Error("Destination interdite : un sous-arbre monté est en lecture seule.");
    }

    const filename = oldPath.split("/").pop() ?? "";
    if (!filename) throw new Error("Chemin source invalide.");
    const at = (name: string): string =>
      cleanFolder ? `${cleanFolder}/${name}` : name;

    const takenInDb = (p: string): boolean => {
      const r = row(db.exec(
        `SELECT id FROM entity WHERE vaultId = ? AND filePath = ? LIMIT 1`,
        [vaultId, p],
      ));
      return !!r && (r["id"] as string) !== id;
    };
    const takenOnDisk = fileExistsAt;

    const dot = filename.lastIndexOf(".");
    const stem = dot > 0 ? filename.slice(0, dot) : filename;
    const ext = dot > 0 ? filename.slice(dot) : "";
    let target = at(filename);
    for (let n = 2; n <= 9999; n++) {
      if (target === oldPath) break;
      if (!takenInDb(target) && !(await takenOnDisk(target))) break;
      target = at(`${stem}-${n}${ext}`);
    }
    if (target !== oldPath && (takenInDb(target) || (await takenOnDisk(target)))) {
      throw new Error(`Aucun nom libre dans ${cleanFolder || "la racine"}.`);
    }
    if (target === oldPath) return { filePath: oldPath, moved: false };

    await entitiesUpdate({ id, filePath: target });
    return { filePath: target, moved: true };
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
      // Le tombstone doit partir avec le DELETE : sans lui, un kill entre les deux
      // laissait le reindex ressusciter la note si le .md avait survécu.
      runInTransaction(db, () => {
        db.run(`DELETE FROM entity WHERE id = ?`, [id]);
        ftsRemove(db, id);
        mentionsRemove(db, id);
        tombstoneAdd(db, id);
      });
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
      FROM entity_fts
      JOIN entity e ON e.id = entity_fts.id
      JOIN entity_type et ON et.id = e.typeId
      WHERE entity_fts MATCH ? AND e.vaultId = ?
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
    // Un INNER JOIN suffit : une entité supprimée emporte ses mentions
    // (mentionsRemove + FK ON DELETE CASCADE).
    const mentionRows = rows(db.exec(
      `SELECT m.sourceId, m.rawText AS context, e.filePath AS sourceFilePath,
              e.typeId AS sourceTypeId, e.fields AS sourceFields
         FROM mention m
         JOIN entity e ON e.id = m.sourceId
        WHERE m.targetId = ?
        ORDER BY m.updatedAt DESC`,
      [id],
    ));
    return mentionRows.map((r) => {
      const filePath = (r["sourceFilePath"] as string) ?? "";
      const fields = safeParseFieldsBlob((r["sourceFields"] as string) || "{}");
      // Le nom de fichier est un slug (« plan-produit ») : titre des champs d'abord.
      const named = ["name", "titre", "title", "nom"]
        .map((k) => fields[k])
        .find((v): v is string => typeof v === "string" && v.trim().length > 0);
      return {
        sourceId: r["sourceId"],
        sourceFilePath: filePath,
        sourceTypeId: (r["sourceTypeId"] as string) ?? "",
        sourceTitle: named ?? filePath.split("/").pop()?.replace(/\.[^.]+$/, "") ?? "",
        context: (r["context"] as string) ?? "",
      };
    });
  };

  // Carte des connaissances : les liens réels ([[…]] et @mentions) entre entités.
  // ponytail: plafond de 5 000 arêtes, les plus citées d'abord ; filtrer par type côté worker si un coffre le dépasse.
  const entitiesGraph = async (): Promise<unknown> => {
    const MAX_EDGES = 5000;
    const edgeRows = rows(db.exec(
      `SELECT m.sourceId AS source, m.targetId AS target, COUNT(*) AS weight
         FROM mention m
         JOIN entity s ON s.id = m.sourceId AND s.vaultId = ?
         JOIN entity t ON t.id = m.targetId AND t.vaultId = ?
        WHERE m.targetId IS NOT NULL AND m.sourceId != m.targetId
        GROUP BY m.sourceId, m.targetId
        ORDER BY weight DESC
        LIMIT ?`,
      [vaultId, vaultId, MAX_EDGES + 1],
    ));
    const truncated = edgeRows.length > MAX_EDGES;
    const edges = edgeRows.slice(0, MAX_EDGES).map((r) => ({
      source: String(r["source"]),
      target: String(r["target"]),
      weight: Number(r["weight"]) || 1,
    }));
    const degree = new Map<string, number>();
    for (const e of edges) {
      degree.set(e.source, (degree.get(e.source) ?? 0) + 1);
      degree.set(e.target, (degree.get(e.target) ?? 0) + 1);
    }
    const ids = [...degree.keys()];
    const nodes: Array<{ id: string; typeId: string; title: string; tags: string[]; degree: number }> = [];
    // Par paquets : SQLite borne le nombre de paramètres liés.
    for (let i = 0; i < ids.length; i += 500) {
      const chunk = ids.slice(i, i + 500);
      const marks = chunk.map(() => "?").join(",");
      const tagRows = rows(db.exec(
        `SELECT et.entityId AS id, t.path AS path FROM entity_tag et JOIN tag t ON t.id = et.tagId
          WHERE et.entityId IN (${marks})`,
        chunk,
      ));
      const tagsById = new Map<string, string[]>();
      for (const r of tagRows) {
        const list = tagsById.get(String(r["id"])) ?? [];
        list.push(String(r["path"]));
        tagsById.set(String(r["id"]), list);
      }
      for (const r of rows(db.exec(`SELECT id, typeId, filePath, fields FROM entity WHERE id IN (${marks})`, chunk))) {
        const id = String(r["id"]);
        const fields = safeParseFieldsBlob(String(r["fields"] ?? ""));
        const fromFile = String(r["filePath"] ?? "").split("/").pop()?.replace(/\.md$/, "") ?? id;
        const title = [fields["title"], fields["name"], fields["per_name"]].find((v) => typeof v === "string" && v.trim());
        nodes.push({
          id,
          typeId: String(r["typeId"]),
          title: typeof title === "string" ? title.trim() : fromFile,
          tags: tagsById.get(id) ?? [],
          degree: degree.get(id) ?? 0,
        });
      }
    }
    return { nodes, edges, truncated };
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

    // Coercition des valeurs existantes quand le KIND d'un champ change (ex :
    // texte → nombre). Sans ça, les valeurs restent dans l'ancien format et
    // s'affichent/évaluent mal. On passe par entitiesUpdate (DB + fichier +
    // op sync) pour que la conversion se propage partout.
    if (Array.isArray(patch.fields)) {
      try {
        const coerceForKind = (v: unknown, kind: string): unknown => {
          switch (kind) {
            case "number": case "currency": case "percent": case "rating":
            case "progress": case "duration": case "autoNumber": {
              const n = Number(v as never);
              return Number.isFinite(n) ? n : null;
            }
            case "bool":
              if (v === true || v === "true" || v === 1) return true;
              if (v === false || v === "false" || v === 0) return false;
              return null;
            case "date": case "datetime": {
              const d = new Date(String(v));
              return isNaN(d.getTime()) ? null : d.toISOString();
            }
            case "multiselect":
              return Array.isArray(v) ? v.map(String) : typeof v === "string" && v ? [v] : [];
            case "select": case "status":
              return Array.isArray(v) ? String(v[0] ?? "") : String(v);
            default:
              return v == null ? v : String(v);
          }
        };
        type FieldLite = { id?: string; name?: string; type?: string; kind?: string };
        const oldFields = JSON.parse((existing["fields"] as string) || "[]") as FieldLite[];
        const newFields = patch.fields as FieldLite[];
        const oldById = new Map(oldFields.map((f) => [f.id, f]));
        const changed = newFields
          .map((nf) => {
            const of = oldById.get(nf.id);
            const oldKind = of?.type ?? of?.kind;
            const newKind = nf.type ?? nf.kind;
            return of && oldKind && newKind && oldKind !== newKind
              ? { name: nf.name ?? "", kind: newKind }
              : null;
          })
          .filter((x): x is { name: string; kind: string } => !!x && !!x.name);

        if (changed.length > 0) {
          const ents = rows(db.exec(`SELECT id, fields FROM entity WHERE typeId = ? AND vaultId = ?`, [id, vaultId]));
          for (const e of ents) {
            const fields = JSON.parse((e["fields"] as string) || "{}") as Record<string, unknown>;
            const fieldPatch: Record<string, unknown> = {};
            for (const ch of changed) {
              const cur = fields[ch.name];
              if (cur === undefined || cur === null || cur === "") continue;
              const next = coerceForKind(cur, ch.kind);
              if (next !== cur) fieldPatch[ch.name] = next;
            }
            if (Object.keys(fieldPatch).length > 0) {
              await entitiesUpdate({ id: e["id"], fields: fieldPatch });
            }
          }
        }
      } catch (err) {
        console.warn("[schema] coercition au changement de type échouée", err);
      }
    }

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
    // Un tag tapé dans une note n'a pas toujours sa ligne : le recolorer depuis l'éditeur la crée.
    if (!findTagByPath(path)) await tagsCreate({ path, label });
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
      FROM entity_fts
      JOIN entity e ON e.id = entity_fts.id
      WHERE entity_fts MATCH ? AND e.vaultId = ?
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
    const pathById = new Map<string, string>();
    try {
      for (const r of rows(
        db.exec(`SELECT id, typeId, filePath FROM entity WHERE vaultId = ?`, [vaultId]),
      )) {
        const fp = (r["filePath"] as string | null) ?? "";
        if (fp) rowsByPath.set(fp, { id: r["id"] as string, typeId: r["typeId"] as string });
        if (fp) pathById.set(r["id"] as string, fp);
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
            // A tombstoned id is a deleted entity whose .md failed to be removed
            // from disk (the op-log delete swallows OPFS unlink errors). Adopting
            // it here is the "resurrection" bug — skip the orphan. A later
            // (re)create or sync-upsert of this id clears the tombstone.
            if (isTombstoned(db, fmId)) continue;
            // Copie périmée d'une entité dont le fichier courant est toujours sur
            // le disque : y re-pointer la ligne ramenait l'ancien titre/dossier.
            // Un déplacement externe, lui, fait disparaître l'ancien chemin.
            const currentPath = pathById.get(fmId);
            if (currentPath && currentPath !== file.relativePath && allRelativePaths.has(currentPath)) continue;
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
          pathById.set(id, file.relativePath);
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
          // Les entités système (@system/…) n'ont pas de fichier : les balayer effaçait engagements et miroir mail partagé.
          `SELECT id, filePath, fields FROM entity WHERE vaultId = ? AND sourceVaultId IS NULL AND filePath NOT LIKE '@system/%'`,
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
      // Idem pour l'index de mentions : les corps adoptés/supprimés par la
      // passe ont pu (dé)créer des backlinks. Synchrone → une transaction.
      try {
        runInTransaction(db, () => mentionsRebuild(db, vaultId));
      } catch (err) {
        console.warn("[reindex] mention rebuild failed (non-fatal)", err);
      }
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
    const clean = sanitizePath(path);
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
    const clean = sanitizePath(path);
    if (!clean) throw new Error("vault.writeFile: empty path");
    const segments = clean.split("/");
    // Même espace de noms `path:` que la création et le déplacement d'entité :
    // sur une clé nue, une écriture binaire et un déplacement visant ce chemin
    // ne s'excluaient pas.
    return runSerialized(`path:${clean}`, async () => {
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

  // ── templates.* ─────────────────────────────────────────────────────────────
  // Un modèle est une entité système `template` : miroir .md, FTS et synchro
  // passent par le chemin commun des entités.

  const SEED_TEMPLATE_IDS = new Set(SEED_TEMPLATES.map((t) => t.id));

  const templateEntityFields = (t: Omit<SaveTemplateInput, "id" | "body">): Record<string, unknown> => ({
    name: t.name,
    description: t.description ?? "",
    icon: t.icon ?? "",
    entityType: t.entityType ?? "",
    frontmatter: t.frontmatter ? JSON.stringify(t.frontmatter) : "",
  });

  const templateRowToApi = (r: SqlRow): TemplateIpc => {
    const id = r["id"] as string;
    const f = safeParseFieldsBlob((r["fields"] as string) || "{}");
    const text = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);
    // La relecture du YAML (reindex) peut déjà avoir redonné un objet.
    let fm: unknown = f["frontmatter"];
    if (typeof fm === "string" && fm) {
      try { fm = JSON.parse(fm); } catch { fm = undefined; }
    }
    return {
      id,
      name: text(f["name"]) ?? "Sans nom",
      description: text(f["description"]),
      icon: text(f["icon"]),
      entityType: text(f["entityType"]),
      body: (r["body"] as string) ?? "",
      frontmatter: fm && typeof fm === "object" && !Array.isArray(fm) ? (fm as Record<string, unknown>) : undefined,
      source: SEED_TEMPLATE_IDS.has(id) ? "seed" : "user",
    };
  };

  const templateRow = (id: string): SqlRow | null =>
    row(db.exec(
      `SELECT id, fields, body FROM entity WHERE id = ? AND typeId = ? AND sourceVaultId IS NULL`,
      [id, TEMPLATE_TYPE_ID],
    ));

  const templatesList = async (input: unknown): Promise<TemplateIpc[]> => {
    const { source = "all" } = (input as { source?: string } | undefined) ?? {};
    return rows(db.exec(
      `SELECT id, fields, body FROM entity
        WHERE vaultId = ? AND typeId = ? AND sourceVaultId IS NULL
        ORDER BY createdAt, id`,
      [vaultId, TEMPLATE_TYPE_ID],
    ))
      .map(templateRowToApi)
      .filter((t) => source === "all" || t.source === source);
  };

  const templatesSave = async (input: unknown): Promise<TemplateIpc> => {
    const { id, body, ...meta } = input as SaveTemplateInput;
    const fields = templateEntityFields(meta);
    const saved = (id && templateRow(id)
      ? await entitiesUpdate({ id, fields, body })
      : await entitiesCreate({ typeId: TEMPLATE_TYPE_ID, fields, body })) as { id: string };
    const r = templateRow(saved.id);
    if (!r) throw new Error(`Modèle introuvable après enregistrement : ${saved.id}`);
    return templateRowToApi(r);
  };

  const templatesDelete = async (input: unknown): Promise<{ id: string; deleted: boolean }> => {
    const { id } = input as { id: string };
    if (!templateRow(id)) return { id, deleted: false };
    await entitiesDelete({ id });
    return { id, deleted: true };
  };

  /**
   * Modèles de départ, une fois par coffre, avant le démarrage de la synchro.
   * Le dossier sur disque sert de marqueur : il survit aux reconstructions de
   * la base (changement de coffre) et reste en place quand on vide les modèles.
   * Ids stables + horodatage TEMPLATE_SEED_TS : deux appareils sèment la même
   * entité, et une édition ou suppression réelle l'emporte partout.
   * ponytail: après reconstruction de la base, le reindex rehorodate les modèles intacts à « maintenant » et le snapshot les repousse ; marquer l'intact dans les champs si un modèle supprimé ailleurs revient.
   */
  const templatesSeedDefaults = async (): Promise<{ seeded: number }> => {
    try {
      await vaultHandle.getDirectoryHandle(TEMPLATE_FOLDER);
      return { seeded: 0 };
    } catch (err) {
      if ((err as DOMException)?.name !== "NotFoundError") throw err;
    }
    const typeRow = row(db.exec(`SELECT name FROM entity_type WHERE id = ?`, [TEMPLATE_TYPE_ID]));
    if (!typeRow) return { seeded: 0 };
    let seeded = 0;
    for (const t of SEED_TEMPLATES) {
      if (isTombstoned(db, t.id)) continue;
      const fields = templateEntityFields(t);
      const stem = resolveFileNameStem("{name}", fields, t.id, TEMPLATE_SEED_TS) || t.id;
      const filePath = `${TEMPLATE_FOLDER}/${stem}.md`;
      const content = serializeFrontmatter({ id: t.id, type: typeRow["name"], ...fields }, t.body);
      await writeVaultFile(vaultHandle, filePath.split("/"), content);
      db.run(
        `INSERT OR IGNORE INTO entity (id, vaultId, typeId, filePath, fields, body, fileHash, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, '', ?, ?)`,
        [t.id, vaultId, TEMPLATE_TYPE_ID, filePath, JSON.stringify(fields), t.body, TEMPLATE_SEED_TS, TEMPLATE_SEED_TS],
      );
      ftsAdd(db, { id: t.id, typeId: TEMPLATE_TYPE_ID, title: t.name, body: t.body, tags: "", path: derivePath(filePath) });
      seeded++;
    }
    return { seeded };
  };

  // ── Dispatch table ─────────────────────────────────────────────────────────

  const mail = buildMailRoutes(db, vaultId, hooks);

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
    "entities.listSummaries": entitiesListSummaries,
    "entities.count": entitiesCount,
    "entities.get": entitiesGet,
    "entities.create": entitiesCreate,
    "entities.update": entitiesUpdate,
    "entities.moveIfFree": entitiesMoveIfFree,
    "entities.delete": entitiesDelete,
    "entities.search": entitiesSearch,
    "entities.listByDateRange": entitiesListByDateRange,
    "entities.subpageDescendants": entitiesSubpageDescendants,
    "entities.graph": entitiesGraph,
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


    "templates.list": templatesList,
    "templates.save": templatesSave,
    "templates.delete": templatesDelete,
    "templates.seedDefaults": templatesSeedDefaults,


    ...buildCalendarRoutes(db, vaultId),
    ...buildChecklistRoutes(db, vaultId),
    ...mail.routes,
    ...buildSyncRoutes(db, vaultHandle, vaultId, mail.mirror),
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

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
  // Decode the US-joined GROUP_CONCAT of tag paths (see ./tag-paths).
  const tags = decodeTagPaths(r["tagPaths"]);
  return {
    id: r["id"],
    typeId: r["typeId"],
    typeName: r["typeName"] ?? "",
    filePath: r["filePath"] ?? "",
    fields,
    body: r["body"] ?? "",
    tags,
    // Provenance of a mounted entity (parent vault id) or `null` for a local
    // row. Only the `entitiesGet` SELECT fetches this column; the list/search
    // SELECTs omit it, so it falls back to `null` there. Carried so lifecycle
    // hooks can route ENTITY_CHANGE ops to the right sync room.
    sourceVaultId: (r["sourceVaultId"] as string | null | undefined) ?? null,
    createdAt: r["createdAt"] ?? now(),
    updatedAt: r["updatedAt"] ?? now(),
  };
}
