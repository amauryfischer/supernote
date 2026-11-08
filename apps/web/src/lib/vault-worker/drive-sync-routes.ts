/**
 * Routes `driveSync.*` : état local de la synchro dossier ↔ Google Drive et
 * écritures de notes venues de Drive. Le réseau Drive se fait sur le thread
 * principal (`lib/drive-sync/`) ; les écritures passent par les routes
 * `entities.*` pour déclencher les hooks (salon en ligne, autres appareils).
 */

import type { DriveSyncLocalFile, DriveSyncStateRow } from "@supernote/ipc";
import type { Database } from "./sqlite-adapter";
import type { RouteHandler } from "./worker-router";
import { row, rows } from "./sql";
import { hashContent, parseFrontmatter } from "./fsa-file-io";

interface DriveSyncDeps {
  readText(path: string): Promise<string>;
  create(input: unknown): Promise<unknown>;
  update(input: unknown): Promise<unknown>;
  remove(input: unknown): Promise<unknown>;
}

const isMarkdown = (p: string) => /\.(md|markdown)$/i.test(p);

export function buildDriveSyncRoutes(db: Database, vaultId: string, deps: DriveSyncDeps): Record<string, RouteHandler> {
  const entityPath = (id: string): string | null =>
    (row(db.exec(`SELECT filePath FROM entity WHERE id = ? AND vaultId = ?`, [id, vaultId]))?.["filePath"] as string | undefined) ?? null;

  // Le contenu exact du disque, jamais resérialisé : le hash doit rester stable d'une passe à l'autre.
  const snapshot = async (entityId: string, filePath: string): Promise<DriveSyncLocalFile> => {
    const content = await deps.readText(filePath);
    return { entityId, filePath, content, fileHash: await hashContent(content) };
  };

  return {
    "driveSync.localFiles": async (input) => {
      const { prefix } = input as { prefix: string };
      const found = rows(
        db.exec(
          `SELECT id, filePath FROM entity WHERE vaultId = ? AND sourceVaultId IS NULL AND substr(filePath, 1, ?) = ?`,
          [vaultId, prefix.length + 1, `${prefix}/`],
        ),
      ).filter((r) => isMarkdown(r["filePath"] as string));
      // Une lecture ratée lève et annule la passe : une note absente de la liste serait prise pour supprimée.
      const out: DriveSyncLocalFile[] = [];
      for (const r of found) out.push(await snapshot(r["id"] as string, r["filePath"] as string));
      return out;
    },

    "driveSync.applyRemote": async (input) => {
      const { entityId, filePath, content } = input as { entityId?: string; filePath: string; content: string };
      const { frontmatter, body } = parseFrontmatter(content);
      const { id: fmId, type: _type, ...fields } = frontmatter;
      if (typeof fields["title"] !== "string" || !fields["title"]) {
        fields["title"] = (filePath.split("/").pop() ?? "").replace(/\.(md|markdown)$/i, "");
      }
      let id = entityId && entityPath(entityId) ? entityId : null;
      if (id) {
        await deps.update({ id, fields, body, filePath: entityPath(id) === filePath ? undefined : filePath });
      } else {
        // Un id de frontmatter déjà porté par une autre note du coffre : nouvel id, pas de vol.
        const reuse = typeof fmId === "string" && fmId && !entityPath(fmId) ? fmId : undefined;
        const created = (await deps.create({ typeId: "note", fields: { ...fields, filePath }, body, id: reuse })) as { id: string };
        id = created.id;
      }
      const path = entityPath(id);
      if (!path) throw new Error(`driveSync.applyRemote: note ${id} introuvable après écriture`);
      return snapshot(id, path);
    },

    "driveSync.deleteLocal": async (input) => {
      const { entityId } = input as { entityId: string };
      if (entityPath(entityId)) await deps.remove({ id: entityId });
      return { ok: true };
    },

    "driveSync.stateList": async (input) => {
      const { linkId } = input as { linkId: string };
      return rows(db.exec(`SELECT * FROM drive_sync_file WHERE linkId = ?`, [linkId])).map(
        (r): DriveSyncStateRow => ({
          linkId: r["linkId"] as string,
          driveFileId: r["driveFileId"] as string,
          entityId: r["entityId"] as string,
          relPath: r["relPath"] as string,
          driveMd5: r["driveMd5"] as string,
          localHash: r["localHash"] as string,
          syncedAt: Number(r["syncedAt"]),
        }),
      );
    },

    "driveSync.stateUpsert": async (input) => {
      const s = input as DriveSyncStateRow;
      db.run(
        `INSERT INTO drive_sync_file (linkId, driveFileId, entityId, relPath, driveMd5, localHash, syncedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(linkId, driveFileId) DO UPDATE SET entityId = excluded.entityId, relPath = excluded.relPath,
           driveMd5 = excluded.driveMd5, localHash = excluded.localHash, syncedAt = excluded.syncedAt`,
        [s.linkId, s.driveFileId, s.entityId, s.relPath, s.driveMd5, s.localHash, s.syncedAt],
      );
      return { ok: true };
    },

    "driveSync.stateRemove": async (input) => {
      const { linkId, driveFileId } = input as { linkId: string; driveFileId: string };
      db.run(`DELETE FROM drive_sync_file WHERE linkId = ? AND driveFileId = ?`, [linkId, driveFileId]);
      return { ok: true };
    },

    "driveSync.stateClearLink": async (input) => {
      const { linkId } = input as { linkId: string };
      db.run(`DELETE FROM drive_sync_file WHERE linkId = ?`, [linkId]);
      return { ok: true };
    },
  };
}
