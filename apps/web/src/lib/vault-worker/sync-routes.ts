/**
 * Routes `sync.*` : pont entre le client de synchro en ligne (thread principal)
 * et le coffre local. Extraites de `worker-router.ts`.
 */

import type { Database } from "./sqlite-adapter";
import type { RouteHandler } from "./worker-router";
import type { MailMirror } from "./mail-routes";
import { row, rows, runInTransaction, type SqlValue } from "./sql";
import {
  serializeFrontmatter,
  writeVaultFile,
  deleteVaultFile,
  hashContent,
  generateId,
} from "./fsa-file-io";
import { moveExcalidrawSibling, deleteExcalidrawSibling } from "./canvas-excalidraw-io";
import { resolveMountWrite, crossProvenanceCollision } from "./mount-provenance";
import { decodeTagPaths } from "./tag-paths";
import { derivePath } from "./path-utils";
import { TEMPLATE_TYPE_ID, TEMPLATE_SEED_TS, EMAIL_AI_CACHE_TYPE_ID, MAIL_COMMITMENT_TYPE_ID } from "./seed-default-types";
import {
  now,
  deriveTitle,
  ftsAdd,
  ftsRemove,
  tombstoneAdd,
  tombstoneClear,
  mentionsRemove,
  mentionsRebuild,
  indexMentions,
  parseTypeFieldsBlob,
  safeParseFieldsBlob,
  applyEntityTags,
} from "./entity-helpers";

export function buildSyncRoutes(
  db: Database,
  vaultHandle: FileSystemDirectoryHandle,
  vaultId: string,
  mail: MailMirror,
): Record<string, RouteHandler> {
  const { MAIL_STATE_THREAD_ID, dropMirroredThread, adoptSharedMailState, upsertSharedMailThread } = mail;

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
      // Column defs of the entity's type (`entity_type.fields`). Travels so a
      // receiver can recreate an unknown custom base WITH its columns.
      typeFields?: unknown[];
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
    // Un modèle de départ intact existe à l'identique sur chaque appareil : le
    // pousser ressusciterait ailleurs un modèle supprimé.
    const res = db.exec(
      `SELECT e.id, e.typeId, et.name AS typeName, et.fields AS typeFields,
              e.filePath, e.fields, e.body,
              e.createdAt, e.updatedAt,
              (SELECT GROUP_CONCAT(t.path, char(31))
                 FROM entity_tag etag JOIN tag t ON t.id = etag.tagId
                WHERE etag.entityId = e.id) AS tagPaths
         FROM entity e JOIN entity_type et ON et.id = e.typeId
        WHERE e.vaultId = ? AND e.sourceVaultId IS NULL
          AND NOT (e.typeId = ? AND e.updatedAt = ?)`,
      [vaultId, TEMPLATE_TYPE_ID, TEMPLATE_SEED_TS],
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
          typeFields: parseTypeFieldsBlob(r["typeFields"]),
          filePath: (r["filePath"] as string) ?? "",
          fields: safeParseFieldsBlob((r["fields"] as string) || "{}"),
          body: (r["body"] as string) ?? "",
          tags: decodeTagPaths(tagPaths),
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
          `SELECT id, typeId, fields, filePath, updatedAt, sourceVaultId FROM entity WHERE id = ?`,
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
            mentionsRemove(db, op.entityId);
            tombstoneAdd(db, op.entityId); // block reindex resurrection
            if (existing["typeId"] === EMAIL_AI_CACHE_TYPE_ID) dropMirroredThread(existing["fields"]);
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
        // Column defs carried by the op (`entity_type.fields`). Empty for
        // delete ops, older producers, or system types with no custom columns.
        const opTypeFields = Array.isArray(payload.typeFields) ? payload.typeFields : [];
        let typeRow = row(db.exec(`SELECT name, fields FROM entity_type WHERE id = ?`, [payload.typeId]));
        if (!typeRow) {
          // Unknown entity type on this device — recreate it WITH the columns
          // the producer transported, so a synced custom base keeps its schema
          // instead of arriving with an empty `[]` (the old data-loss bug). Any
          // mounted/freshly-synced entity then satisfies the FK with full defs.
          const nowIso = now();
          db.run(
            `INSERT OR IGNORE INTO entity_type (id, vaultId, name, plural, fields, isSystem, createdAt, updatedAt)
             VALUES (?, ?, ?, ?, ?, 0, ?, ?)`,
            [
              payload.typeId,
              vaultId,
              payload.typeName || payload.typeId,
              payload.typeName || payload.typeId,
              JSON.stringify(opTypeFields),
              nowIso,
              nowIso,
            ],
          );
          typeRow = { name: payload.typeName || payload.typeId };
        } else if (opTypeFields.length > 0) {
          // The type already exists locally but may have been created earlier
          // with an empty `[]` (a minimal stub from before columns travelled, or
          // an op that arrived in a different order). Backfill the columns when
          // the op carries them and the local copy is still empty — never clobber
          // a non-empty local schema (LWW on entities, not on type defs here).
          const localFields = parseTypeFieldsBlob(typeRow["fields"]);
          if (localFields.length === 0) {
            db.run(
              `UPDATE entity_type SET fields = ?, updatedAt = ? WHERE id = ?`,
              [JSON.stringify(opTypeFields), now(), payload.typeId],
            );
          }
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
          const oldPath = (existing["filePath"] as string) ?? "";
          // ⚠️ Renommage ou déplacement distant : l'ancien .md survivait, et le
          // reindex (toutes les 30 s) y re-pointait l'entité — ancien titre,
          // ancien dossier. Supprimé seulement une fois l'UPDATE passé.
          if (
            provenance === null &&
            oldPath !== storedPath &&
            isMarkdownPath(oldPath) &&
            isMarkdownPath(storedPath)
          ) {
            try {
              await deleteVaultFile(vaultHandle, oldPath.split("/"));
            } catch {
              /* already gone */
            }
            await moveExcalidrawSibling(vaultHandle, oldPath, storedPath);
          }
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

        // A synced (re)upsert of this id supersedes any earlier deletion.
        tombstoneClear(db, op.entityId);
        db.run(`DELETE FROM entity_tag WHERE entityId = ?`, [op.entityId]);
        await applyEntityTags(db, vaultId, op.entityId, payload.tags ?? [], payload.updatedAt);
        // Le cache mail n'est pas une note : l'indexer ferait remonter objets et
        // extraits de mails dans la recherche globale.
        if (payload.typeId === EMAIL_AI_CACHE_TYPE_ID || payload.typeId === MAIL_COMMITMENT_TYPE_ID) {
          ftsRemove(db, op.entityId);
        } else {
          ftsAdd(db, {
            id: op.entityId,
            typeId: payload.typeId,
            title: deriveTitle(JSON.stringify(fields), payload.filePath),
            body: payload.body ?? "",
            tags: (payload.tags ?? []).join(" "),
            path: derivePath(storedPath),
          });
          indexMentions(db, vaultId, op.entityId, payload.body ?? "");
        }

        // Dénormalisation sync → mail_thread : un autre appareil a lu Gmail pour
        // nous (miroir partagé) ou a calculé l'IA d'un fil.
        if (payload.typeId === EMAIL_AI_CACHE_TYPE_ID) {
          const tid = fields["eac_thread_id"] as string | undefined;
          const acct = fields["eac_account_email"] as string | undefined;
          if (tid === MAIL_STATE_THREAD_ID && acct) adoptSharedMailState(acct, fields);
          else if (tid && acct) {
            upsertSharedMailThread(acct, tid, fields);
            db.run(
              `UPDATE mail_thread
                 SET aiCategory          = COALESCE(?, aiCategory),
                     aiCategoryConfidence = COALESCE(?, aiCategoryConfidence),
                     aiCategoryRuns       = COALESCE(?, aiCategoryRuns),
                     aiCategoryAt         = COALESCE(?, aiCategoryAt),
                     aiSummary            = COALESCE(?, aiSummary),
                     aiSummaryFp          = COALESCE(?, aiSummaryFp),
                     aiSummaryAt          = COALESCE(?, aiSummaryAt)
               WHERE accountId = ? AND id = ?`,
              [
                (fields["eac_category"] as SqlValue) ?? null,
                (fields["eac_category_confidence"] as SqlValue) ?? null,
                (fields["eac_category_runs"] as SqlValue) ?? null,
                (fields["eac_category_at"] as SqlValue) ?? null,
                (fields["eac_summary"] as SqlValue) ?? null,
                (fields["eac_summary_fp"] as SqlValue) ?? null,
                (fields["eac_summary_at"] as SqlValue) ?? null,
                acct,
                tid,
              ],
            );
          }
        }

        applied++;
      } catch (err) {
        console.warn(`[sync.applyOps] op ${op.opId} failed (non-fatal)`, err);
        skipped++;
      }
    }
    // Gros batch (hydratation initiale d'un salon, remontage) : une op citant
    // une entité arrivée PLUS TARD dans le même batch a raté sa résolution au
    // fil de l'eau (la cible n'existait pas encore). Une passe complète
    // synchrone, en une transaction, répare ces trous d'ordre d'arrivée. Les
    // petits batchs (édition incrémentale) gardent le chemin par-op ci-dessus.
    if (applied >= 50) {
      try {
        runInTransaction(db, () => mentionsRebuild(db, vaultId));
      } catch (err) {
        console.warn("[sync.applyOps] mention rebuild failed (non-fatal)", err);
      }
    }
    return { applied, skipped };
  };

  /** Liste les montages (vault_mount) par provenance. null = montages directs
   *  du père ; un cloudId = montages déclarés DANS ce salon (récursion). */
  const syncListMounts = async (input: unknown): Promise<unknown> => {
    const { sourceVaultId } = (input as { sourceVaultId?: string | null }) ?? {};
    const provenance = sourceVaultId ?? null;
    const res = provenance === null
      ? db.exec(
          `SELECT fields FROM entity WHERE vaultId = ? AND typeId = 'vault_mount' AND sourceVaultId IS NULL`,
          [vaultId],
        )
      : db.exec(
          `SELECT fields FROM entity WHERE vaultId = ? AND typeId = 'vault_mount' AND sourceVaultId = ?`,
          [vaultId, provenance],
        );
    const mounts = rows(res).map((r) => {
      const f = safeParseFieldsBlob((r["fields"] as string) || "{}");
      return {
        serverUrl: typeof f["serverUrl"] === "string" ? (f["serverUrl"] as string) : "",
        vaultKey: typeof f["vaultKey"] === "string" ? (f["vaultKey"] as string) : "",
        token: typeof f["token"] === "string" ? (f["token"] as string) : "",
        label: typeof f["label"] === "string" ? (f["label"] as string) : "",
      };
    }).filter((m) => m.vaultKey);
    return { mounts };
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
      mentionsRemove(db, id);
    }
    return { removed: victims.length };
  };

  return {
    "sync.snapshot": syncSnapshot,
    "sync.head": syncHead,
    "sync.applyOps": syncApplyOps,
    "sync.purgeMounted": syncPurgeMounted,
    "sync.listMounts": syncListMounts,
  };
}
