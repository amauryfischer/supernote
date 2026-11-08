import type { DriveSyncLocalFile, DriveSyncStateRow } from "@supernote/ipc";
import { trpcVanillaClient } from "@/lib/trpc/client";
import type { DriveSyncLink } from "./links";
import {
  downloadText,
  ensureFolderPath,
  listFolderTree,
  moveRename,
  trash,
  uploadContent,
  uploadNew,
  type RemoteFile,
} from "./drive-api";

export interface DriveSyncReport {
  uploaded: number;
  downloaded: number;
  conflicts: number;
  deleted: number;
  errors: number;
}

const rpc = trpcVanillaClient.driveSync;

const dirOf = (rel: string) => (rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/")) : "");
const baseOf = (rel: string) => rel.slice(rel.lastIndexOf("/") + 1);

const frontmatterId = (content: string): string | null => {
  if (!content.startsWith("---")) return null;
  const end = content.indexOf("\n---", 3);
  const match = /^id:\s*["']?([^"'\s]+)["']?\s*$/m.exec(content.slice(0, end < 0 ? undefined : end));
  return match?.[1] ?? null;
};

const withoutId = (content: string) => content.replace(/^(---[\s\S]*?)^id:.*\n/m, "$1");

/** Une passe de synchro dans les deux sens pour une liaison (tableau de décision de la spec 2026-11-06). */
export async function syncLink(clientId: string, link: DriveSyncLink): Promise<DriveSyncReport> {
  const report: DriveSyncReport = { uploaded: 0, downloaded: 0, conflicts: 0, deleted: 0, errors: 0 };
  const prefix = link.vaultFolder;
  const relOf = (filePath: string) => filePath.slice(prefix.length + 1);
  const pathOf = (rel: string) => `${prefix}/${rel}`;

  const [local, tree, state] = await Promise.all([
    rpc.localFiles.query({ prefix }),
    listFolderTree(clientId, link.driveFolderId),
    rpc.stateList.query({ linkId: link.id }),
  ]);
  const { files: remote, folders } = tree;
  const localById = new Map(local.map((l) => [l.entityId, l]));
  const remoteById = new Map(remote.map((r) => [r.id, r]));
  const claimedLocal = new Set<string>();
  const claimedRemote = new Set<string>();

  const agree = (entityId: string, driveFileId: string, relPath: string, driveMd5: string, localHash: string) =>
    rpc.stateUpsert.mutate({ linkId: link.id, driveFileId, entityId, relPath, driveMd5, localHash, syncedAt: Date.now() });

  const pushNew = async (l: DriveSyncLocalFile) => {
    const rel = relOf(l.filePath);
    const parent = await ensureFolderPath(clientId, folders, dirOf(rel));
    const created = await uploadNew(clientId, parent, baseOf(rel), l.content);
    await agree(l.entityId, created.id, rel, created.md5, l.fileHash);
    report.uploaded++;
  };

  // Le chemin local fait foi : le nom de fichier suit le titre de la note.
  const alignDrivePath = async (r: RemoteFile, rel: string) => {
    if (r.relPath === rel) return;
    const parent = await ensureFolderPath(clientId, folders, dirOf(rel));
    await moveRename(clientId, r.id, baseOf(rel), parent, r.parentId);
  };

  const pull = async (r: RemoteFile, content: string, entityId?: string) => {
    const res = await rpc.applyRemote.mutate({ entityId, filePath: pathOf(r.relPath), content });
    // Frontmatter ajouté ou normalisé par le coffre : Drive reçoit le fichier tel qu'écrit, sinon écho sans fin.
    const md5 = res.content === content ? r.md5 : await uploadContent(clientId, r.id, res.content);
    const rel = relOf(res.filePath);
    await alignDrivePath(r, rel);
    await agree(res.entityId, r.id, rel, md5, res.fileHash);
    report.downloaded++;
  };

  // La note du coffre reste ; la version Drive devient une note sœur, rien n'est écrasé.
  const conflict = async (l: DriveSyncLocalFile, r: RemoteFile, driveContent: string) => {
    const rel = relOf(l.filePath);
    const stem = baseOf(rel).replace(/\.(md|markdown)$/i, "");
    const day = new Date().toISOString().slice(0, 10);
    const conflictRel = `${dirOf(rel) ? `${dirOf(rel)}/` : ""}${stem} (conflit Drive ${day}).md`;
    await rpc.applyRemote.mutate({ filePath: pathOf(conflictRel), content: withoutId(driveContent) });
    const md5 = await uploadContent(clientId, r.id, l.content);
    await alignDrivePath(r, rel);
    await agree(l.entityId, r.id, rel, md5, l.fileHash);
    report.conflicts++;
  };

  const reconcile = async (l: DriveSyncLocalFile, r: RemoteFile, s: DriveSyncStateRow | null) => {
    const localChanged = !s || l.fileHash !== s.localHash;
    const driveChanged = !s || r.md5 !== s.driveMd5;
    const rel = relOf(l.filePath);
    if (s && !localChanged && !driveChanged) {
      if (rel !== s.relPath) {
        await alignDrivePath(r, rel);
        await agree(l.entityId, r.id, rel, r.md5, l.fileHash);
      } else if (r.relPath !== s.relPath) {
        await pull(r, l.content, l.entityId);
      }
      return;
    }
    if (localChanged && !driveChanged) {
      const md5 = await uploadContent(clientId, r.id, l.content);
      await alignDrivePath(r, rel);
      await agree(l.entityId, r.id, rel, md5, l.fileHash);
      report.uploaded++;
      return;
    }
    const content = await downloadText(clientId, r.id);
    if (!localChanged) return pull(r, content, l.entityId);
    if (content === l.content) {
      await alignDrivePath(r, rel);
      return agree(l.entityId, r.id, rel, r.md5, l.fileHash);
    }
    return conflict(l, r, content);
  };

  const guarded = async (what: string, fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch (err) {
      report.errors++;
      console.warn(`[drive-sync] ${what}`, err);
    }
  };

  for (const s of state) {
    const l = localById.get(s.entityId);
    const r = remoteById.get(s.driveFileId);
    if (l) claimedLocal.add(l.entityId);
    if (r) claimedRemote.add(r.id);
    await guarded(s.relPath, async () => {
      if (l && r) return reconcile(l, r, s);
      // L'état ne part qu'après l'action : un échec réseau ne doit pas ressusciter une note supprimée.
      const forget = () => rpc.stateRemove.mutate({ linkId: link.id, driveFileId: s.driveFileId });
      if (!l && !r) return forget();
      if (l) {
        // Disparu de Drive : supprimer seulement une note restée telle quelle, sinon la renvoyer.
        if (l.fileHash === s.localHash) {
          await rpc.deleteLocal.mutate({ entityId: l.entityId });
          await forget();
          report.deleted++;
        } else {
          await forget();
          await pushNew(l);
        }
      } else if (r) {
        // Supprimée du coffre : corbeille Drive (30 jours), sauf fichier modifié sur Drive entre-temps.
        if (r.md5 === s.driveMd5) {
          await trash(clientId, r.id);
          await forget();
          report.deleted++;
        } else await pull(r, await downloadText(clientId, r.id));
      }
    });
  }

  for (const r of remote) {
    if (claimedRemote.has(r.id)) continue;
    await guarded(r.relPath, async () => {
      const content = await downloadText(clientId, r.id);
      const id = frontmatterId(content);
      const byId = id && !claimedLocal.has(id) ? localById.get(id) : undefined;
      const byPath = byId ?? local.find((l) => !claimedLocal.has(l.entityId) && relOf(l.filePath) === r.relPath && l.content === content);
      if (byPath) {
        claimedLocal.add(byPath.entityId);
        return reconcile(byPath, r, null);
      }
      return pull(r, content);
    });
  }

  for (const l of local) {
    if (!claimedLocal.has(l.entityId)) await guarded(l.filePath, () => pushNew(l));
  }

  return report;
}
