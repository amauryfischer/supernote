import { googleRequest } from "@/lib/google-api";
import { DRIVE_FULL_SCOPE } from "@/lib/google-drive";

const API = "https://www.googleapis.com/drive/v3";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3";
const FOLDER_MIME = "application/vnd.google-apps.folder";

/** Fichiers Google natifs : reflétés dans le coffre par un pointeur `.gdoc`/`.gsheet`/`.gslides`, ouvert dans GDocViewer. */
export const NATIVE_KINDS: Record<string, { ext: string; urlType: string }> = {
  "application/vnd.google-apps.document": { ext: ".gdoc", urlType: "document" },
  "application/vnd.google-apps.spreadsheet": { ext: ".gsheet", urlType: "spreadsheets" },
  "application/vnd.google-apps.presentation": { ext: ".gslides", urlType: "presentation" },
};

export interface NativeFile {
  id: string;
  /** Chemin relatif du pointeur local (nom Drive + extension du type). */
  relPath: string;
  pointer: string;
}

export const pointerContent = (id: string, mimeType: string) =>
  JSON.stringify({ url: `https://docs.google.com/${NATIVE_KINDS[mimeType]?.urlType ?? "document"}/d/${id}/edit`, doc_id: id });

export interface RemoteFile {
  id: string;
  parentId: string;
  relPath: string;
  md5: string;
}

interface DriveItem {
  id: string;
  name: string;
  mimeType: string;
  md5Checksum?: string;
}

const call = async <T>(clientId: string, url: string, init?: Parameters<typeof googleRequest>[3]): Promise<T> =>
  (await (await googleRequest(clientId, DRIVE_FULL_SCOPE, url, init, "Drive")).json()) as T;

const quote = (s: string) => s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");

async function listChildren(clientId: string, parentId: string, foldersOnly = false): Promise<DriveItem[]> {
  const q = `'${quote(parentId)}' in parents and trashed = false${foldersOnly ? ` and mimeType = '${FOLDER_MIME}'` : ""}`;
  const out: DriveItem[] = [];
  let pageToken = "";
  do {
    const params = new URLSearchParams({ q, fields: "nextPageToken,files(id,name,mimeType,md5Checksum)", pageSize: "1000", orderBy: "name" });
    if (pageToken) params.set("pageToken", pageToken);
    const page = await call<{ files?: DriveItem[]; nextPageToken?: string }>(clientId, `${API}/files?${params}`);
    out.push(...(page.files ?? []));
    pageToken = page.nextPageToken ?? "";
  } while (pageToken);
  return out;
}

export const listChildFolders = async (clientId: string, parentId: string) =>
  (await listChildren(clientId, parentId, true)).map(({ id, name }) => ({ id, name }));

/** `.md` du dossier lié et de ses sous-dossiers ; `folders` = chemin relatif → id (racine = ""). */
// shortcut: une requête par sous-dossier ; passer à `changes.list` au-delà de ~50 sous-dossiers ou si le quota bronche.
export async function listFolderTree(
  clientId: string,
  rootId: string,
): Promise<{ files: RemoteFile[]; natives: NativeFile[]; folders: Map<string, string> }> {
  const files: RemoteFile[] = [];
  const natives: NativeFile[] = [];
  const folders = new Map<string, string>([["", rootId]]);
  const queue: Array<[string, string]> = [["", rootId]];
  for (let next = queue.shift(); next; next = queue.shift()) {
    const [dir, id] = next;
    for (const item of await listChildren(clientId, id)) {
      const rel = dir ? `${dir}/${item.name}` : item.name;
      if (item.mimeType === FOLDER_MIME) {
        folders.set(rel, item.id);
        queue.push([rel, item.id]);
      } else if (/\.(md|markdown)$/i.test(item.name)) {
        files.push({ id: item.id, parentId: id, relPath: rel, md5: item.md5Checksum ?? "" });
      } else if (NATIVE_KINDS[item.mimeType]) {
        natives.push({ id: item.id, relPath: `${rel}${NATIVE_KINDS[item.mimeType]?.ext}`, pointer: pointerContent(item.id, item.mimeType) });
      }
    }
  }
  return { files, natives, folders };
}

export async function createFolder(clientId: string, name: string, parentId: string): Promise<string> {
  const res = await call<{ id: string }>(clientId, `${API}/files?fields=id`, {
    method: "POST",
    json: true,
    body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: [parentId] }),
  });
  return res.id;
}

/** Id du sous-dossier `relDir` sous la racine, créé au besoin ; `folders` est mis à jour. */
export async function ensureFolderPath(clientId: string, folders: Map<string, string>, relDir: string): Promise<string> {
  let path = "";
  let parent = folders.get("") ?? "";
  for (const seg of relDir.split("/").filter(Boolean)) {
    path = path ? `${path}/${seg}` : seg;
    let id = folders.get(path);
    if (!id) {
      id = await createFolder(clientId, seg, parent);
      folders.set(path, id);
    }
    parent = id;
  }
  return parent;
}

export async function downloadText(clientId: string, fileId: string): Promise<string> {
  const res = await googleRequest(clientId, DRIVE_FULL_SCOPE, `${API}/files/${fileId}?alt=media`, {}, "Drive");
  return res.text();
}

const BOUNDARY = "supernote-drive-sync";
const multipart = (metadata: object, content: string) =>
  `--${BOUNDARY}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
  `--${BOUNDARY}\r\nContent-Type: text/markdown; charset=UTF-8\r\n\r\n${content}\r\n--${BOUNDARY}--`;

export async function uploadNew(clientId: string, parentId: string, name: string, content: string): Promise<{ id: string; md5: string }> {
  const res = await call<{ id: string; md5Checksum?: string }>(clientId, `${UPLOAD}/files?uploadType=multipart&fields=id,md5Checksum`, {
    method: "POST",
    headers: { "Content-Type": `multipart/related; boundary=${BOUNDARY}` },
    body: multipart({ name, parents: [parentId], mimeType: "text/markdown" }, content),
  });
  return { id: res.id, md5: res.md5Checksum ?? "" };
}

export async function uploadContent(clientId: string, fileId: string, content: string): Promise<string> {
  const res = await call<{ md5Checksum?: string }>(clientId, `${UPLOAD}/files/${fileId}?uploadType=media&fields=md5Checksum`, {
    method: "PATCH",
    headers: { "Content-Type": "text/markdown; charset=UTF-8" },
    body: content,
  });
  return res.md5Checksum ?? "";
}

export async function moveRename(clientId: string, fileId: string, name: string, addParent?: string, removeParent?: string): Promise<void> {
  const params = new URLSearchParams({ fields: "id" });
  if (addParent && removeParent && addParent !== removeParent) {
    params.set("addParents", addParent);
    params.set("removeParents", removeParent);
  }
  await call(clientId, `${API}/files/${fileId}?${params}`, { method: "PATCH", json: true, body: JSON.stringify({ name }) });
}

export async function trash(clientId: string, fileId: string): Promise<void> {
  await call(clientId, `${API}/files/${fileId}?fields=id`, { method: "PATCH", json: true, body: JSON.stringify({ trashed: true }) });
}

/** Id du sous-dossier `relDir` sous `rootId`, résolu par nom et créé au besoin (sans lister tout l'arbre). */
export async function folderIdFor(clientId: string, rootId: string, relDir: string): Promise<string> {
  let parent = rootId;
  for (const seg of relDir.split("/").filter(Boolean)) {
    const hit = (await listChildFolders(clientId, parent)).find((f) => f.name === seg);
    parent = hit ? hit.id : await createFolder(clientId, seg, parent);
  }
  return parent;
}

export async function createNative(clientId: string, name: string, mimeType: string, parentId: string): Promise<string> {
  const res = await call<{ id: string }>(clientId, `${API}/files?fields=id`, {
    method: "POST",
    json: true,
    body: JSON.stringify({ name, mimeType, parents: [parentId] }),
  });
  return res.id;
}
