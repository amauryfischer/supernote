/**
 * vault-handle-storage — persists a FileSystemDirectoryHandle in IndexedDB.
 *
 * Handles are serializable across sessions (Chrome 86+). The stored handle
 * must be re-verified for permission on each page load because permission
 * state is NOT persisted across sessions by the browser.
 */

const DB_NAME = "supernote-vault";
const DB_VERSION = 1;
const STORE_NAME = "handles";
const HANDLE_KEY = "vaultHandle";

function openIdb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE_NAME);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveVaultHandle(handle: FileSystemDirectoryHandle): Promise<void> {
  const db = await openIdb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(handle, HANDLE_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function loadVaultHandle(): Promise<FileSystemDirectoryHandle | null> {
  const db = await openIdb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const req = tx.objectStore(STORE_NAME).get(HANDLE_KEY);
    req.onsuccess = () => resolve((req.result as FileSystemDirectoryHandle) ?? null);
    req.onerror = () => reject(req.error);
  });
}

export async function clearVaultHandle(): Promise<void> {
  const db = await openIdb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).delete(HANDLE_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * File System Access API extended types — not yet in all TS lib definitions.
 * Chrome 86+ supports queryPermission/requestPermission on file handles.
 */
interface FileSystemHandlePermissionDescriptor {
  mode: "read" | "readwrite";
}

interface FileSystemDirectoryHandleWithPermission extends FileSystemDirectoryHandle {
  queryPermission(desc: FileSystemHandlePermissionDescriptor): Promise<PermissionState>;
  requestPermission(desc: FileSystemHandlePermissionDescriptor): Promise<PermissionState>;
}

/**
 * Verify (and if needed, re-request) read-write permission for the handle.
 * Returns true if permission is granted, false otherwise.
 */
export async function verifyHandlePermission(
  handle: FileSystemDirectoryHandle,
  request = false,
): Promise<boolean> {
  const h = handle as FileSystemDirectoryHandleWithPermission;
  const opts: FileSystemHandlePermissionDescriptor = { mode: "readwrite" };
  const state = await h.queryPermission(opts);
  if (state === "granted") return true;
  if (!request) return false;
  const newState = await h.requestPermission(opts);
  return newState === "granted";
}
