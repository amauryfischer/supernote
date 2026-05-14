/**
 * Persist the Git sync configuration in IndexedDB.
 *
 * The PAT is the sensitive bit — we keep it OUT of the vault folder (which
 * is the git worktree itself) so a stray commit never sends the token to
 * the remote. IndexedDB is per-origin and per-browser, which matches the
 * security model the user already accepts for the FSA handle.
 *
 * The config object itself is small and changes rarely (URL + token + ref);
 * a single document keyed by `"git"` is enough.
 */

const DB_NAME = "supernote-vault";
const STORE_NAME = "git-config";
const KEY = "config";

export interface StoredGitConfig {
  url: string;
  token: string | null;
  ref: string;
  /** ISO timestamp of the last successful push. */
  lastSyncAt?: string;
  /**
   * SHA the local worktree is "anchored at" — i.e. the commit whose tree
   * matches the local files as of the last successful sync. `syncOnce`
   * uses this as the merge baseline to distinguish local-only changes
   * from remote-only changes from conflicting changes.
   */
  lastSyncSha?: string | null;
}

// Mirrors `vault-handle-storage.ts` — they share the same DB and MUST use
// the same version. See that file for the lockstep rationale.
function openIdb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 3);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("handles")) {
        db.createObjectStore("handles");
      }
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
      if (!db.objectStoreNames.contains("vaults")) {
        db.createObjectStore("vaults", { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveGitConfig(config: StoredGitConfig): Promise<void> {
  const db = await openIdb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(config, KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function loadGitConfig(): Promise<StoredGitConfig | null> {
  const db = await openIdb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const req = tx.objectStore(STORE_NAME).get(KEY);
    req.onsuccess = () => resolve((req.result as StoredGitConfig | undefined) ?? null);
    req.onerror = () => reject(req.error);
  });
}

export async function clearGitConfig(): Promise<void> {
  const db = await openIdb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).delete(KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
