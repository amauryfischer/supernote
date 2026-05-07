/**
 * worker-router — handles tRPC-style route dispatch inside the vault web worker.
 *
 * Implements the same procedure surface as the Electron main process:
 * vault.*, entities.*, schemas.*, tags.*, views.*, search.*
 *
 * Uses sql.js Database directly (no Prisma) and FSA for file I/O.
 */

import type { Database } from "sql.js";
import {
  parseFrontmatter,
  serializeFrontmatter,
  walkMarkdownFiles,
  writeVaultFile,
  deleteVaultFile,
  hashContent,
  generateId,
} from "./fsa-file-io";

type SqlValue = string | number | null | Uint8Array;
type SqlRow = Record<string, SqlValue>;

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

// ── Router implementation ─────────────────────────────────────────────────────

export type RouteHandler = (input: unknown) => Promise<unknown>;

export function buildRouter(
  db: Database,
  vaultHandle: FileSystemDirectoryHandle,
  vaultId: string,
): Record<string, RouteHandler> {
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

    let sql = `
      SELECT e.id, e.typeId, et.name as typeName, e.filePath, e.fields, e.body,
             e.createdAt, e.updatedAt
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
      `SELECT e.id, e.typeId, et.name as typeName, e.filePath, e.fields, e.body, e.createdAt, e.updatedAt
       FROM entity e JOIN entity_type et ON et.id = e.typeId WHERE e.id = ?`,
      [id],
    ));
    if (!r) throw new Error(`Entity not found: ${id}`);
    return entityRowToApi(r);
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

    // Determine file path
    const fileName = `${id}.md`;
    const dir = (typeRow["defaultPath"] as string) ?? "";
    const relativePath = dir ? `${dir}/${fileName}` : fileName;

    const frontmatter: Record<string, unknown> = { id, type: typeRow["name"], fields, ...fields };
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

    return entitiesGet({ id });
  };

  const entitiesUpdate = async (input: unknown): Promise<unknown> => {
    const { id, fields, body, tags } = input as {
      id: string;
      fields?: Record<string, unknown>;
      body?: string;
      tags?: string[];
    };
    const ts = now();
    const existing = row(db.exec(
      `SELECT fields, body, filePath, typeId FROM entity WHERE id = ?`, [id],
    ));
    if (!existing) throw new Error(`Entity not found: ${id}`);

    const newFields = fields
      ? { ...JSON.parse(existing["fields"] as string), ...fields }
      : JSON.parse(existing["fields"] as string);
    const newBody = body ?? (existing["body"] as string) ?? "";

    // Rewrite the .md file
    const typeRow = row(db.exec(`SELECT name FROM entity_type WHERE id = ?`, [existing["typeId"] ?? null]));
    const frontmatter: Record<string, unknown> = {
      id,
      type: typeRow?.["name"] ?? "",
      fields: newFields,
    };
    const content = serializeFrontmatter(frontmatter, newBody);
    const pathSegs = (existing["filePath"] as string).split("/");
    await writeVaultFile(vaultHandle, pathSegs, content);
    const hash = await hashContent(content);

    db.run(
      `UPDATE entity SET fields = ?, body = ?, fileHash = ?, updatedAt = ? WHERE id = ?`,
      [JSON.stringify(newFields), newBody, hash, ts, id],
    );

    if (tags !== undefined) {
      db.run(`DELETE FROM entity_tag WHERE entityId = ?`, [id]);
      await applyEntityTags(db, vaultId, id, tags, ts);
    }

    return entitiesGet({ id });
  };

  const entitiesDelete = async (input: unknown): Promise<unknown> => {
    const { id } = input as { id: string };
    const existing = row(db.exec(`SELECT filePath FROM entity WHERE id = ?`, [id]));
    if (existing) {
      try {
        await deleteVaultFile(vaultHandle, (existing["filePath"] as string).split("/"));
      } catch {
        // File may already be gone
      }
      db.run(`DELETE FROM entity WHERE id = ?`, [id]);
    }
    return { id, deleted: true };
  };

  const entitiesSearch = async (input: unknown): Promise<unknown> => {
    const { query, typeId, limit } = input as {
      query: string;
      typeId?: string;
      limit?: number;
    };
    return searchQuery({ query, typeId, limit });
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

  // ── tags.* ────────────────────────────────────────────────────────────────

  const tagsList = async (): Promise<unknown> => {
    const tagRows = rows(db.exec(
      `SELECT id, path, label, parentPath, color, createdAt, updatedAt FROM tag WHERE vaultId = ? ORDER BY path ASC`,
      [vaultId],
    ));
    return tagRows.map((r) => ({
      id: r["id"],
      path: r["path"],
      label: r["label"],
      parentPath: r["parentPath"] ?? null,
      color: r["color"] ?? null,
      createdAt: r["createdAt"],
      updatedAt: r["updatedAt"],
    }));
  };

  const tagsCreate = async (input: unknown): Promise<unknown> => {
    const { path, label, parentPath, color } = input as {
      path: string;
      label: string;
      parentPath?: string;
      color?: string;
    };
    const id = generateId();
    const ts = now();
    db.run(
      `INSERT OR IGNORE INTO tag (id, vaultId, path, label, parentPath, color, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, vaultId, path, label, parentPath ?? null, color ?? null, ts, ts],
    );
    return tagsList().then((list) => (list as unknown[]).find((t: unknown) => (t as { path: string }).path === path));
  };

  // ── views.* ───────────────────────────────────────────────────────────────

  const viewsList = async (): Promise<unknown> => {
    const viewRows = rows(db.exec(
      `SELECT id, name, kind, entityTypeId, config, isDefault, createdAt, updatedAt
       FROM view WHERE vaultId = ? ORDER BY name ASC`,
      [vaultId],
    ));
    return viewRows.map((r) => ({
      id: r["id"],
      name: r["name"],
      kind: r["kind"],
      entityTypeId: r["entityTypeId"] ?? null,
      config: JSON.parse((r["config"] as string) || "{}"),
      isDefault: Boolean(r["isDefault"]),
      createdAt: r["createdAt"],
      updatedAt: r["updatedAt"],
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

    let sql = `
      SELECT e.id as entityId, e.typeId, et.name as typeName, e.filePath,
             snippet(entity_fts, 1, '<mark>', '</mark>', '...', 32) as excerpt,
             rank as score
      FROM entity_fts
      JOIN entity e ON e.id = entity_fts.id
      JOIN entity_type et ON et.id = e.typeId
      WHERE entity_fts MATCH ? AND e.vaultId = ?
    `;
    const params: SqlValue[] = [query, vaultId];
    if (typeId) { sql += ` AND e.typeId = ?`; params.push(typeId); }
    sql += ` ORDER BY rank LIMIT ? OFFSET ?`;
    params.push(lim, off);

    const resultRows = rows(db.exec(sql, params));
    const items = resultRows.map((r) => ({
      entityId: r["entityId"],
      typeId: r["typeId"],
      typeName: r["typeName"],
      filePath: r["filePath"],
      title: (r["filePath"] as string).split("/").pop()?.replace(".md", "") ?? "",
      excerpts: [r["excerpt"] ?? ""].filter(Boolean),
      score: Math.max(0, Math.min(1, 1 - (r["score"] as number ?? 0) * -0.1)),
      semantic: false,
      tags: [],
    }));
    return { items, total: items.length, durationMs: 0 };
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
        const fields = (frontmatter["fields"] as Record<string, unknown>) ?? {};
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
        indexed++;
      } catch {
        // Skip unparseable files
      }
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

    "tags.list": tagsList,
    "tags.create": tagsCreate,

    "views.list": viewsList,

    "search.query": searchQuery,
    "search.semantic": async () => ({ items: [], total: 0, durationMs: 0 }),
    "search.hybrid": searchQuery,

    "system.getAppInfo": systemGetAppInfo,

    "vault.reindex": reindexVault,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function entityRowToApi(r: SqlRow): unknown {
  const fields = JSON.parse((r["fields"] as string) || "{}");
  return {
    id: r["id"],
    typeId: r["typeId"],
    typeName: r["typeName"] ?? "",
    filePath: r["filePath"] ?? "",
    fields,
    body: r["body"] ?? "",
    tags: [],
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
