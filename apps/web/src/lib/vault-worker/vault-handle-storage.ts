/**
 * vault-handle-storage — persists FileSystemDirectoryHandles in IndexedDB.
 *
 * Handles are serializable across sessions (Chrome 86+). The stored handle
 * must be re-verified for permission on each page load because permission
 * state is NOT persisted across sessions by the browser.
 *
 * v3 adds a multi-vault registry (`vaults` store keyed by id) on top of the
 * legacy single-handle slot (`handles/vaultHandle`). The legacy slot is
 * still written on every switch so older code paths (e.g. GitSyncProvider)
 * can keep using `loadVaultHandle()` to read the *active* handle.
 */

const DB_NAME = "supernote-vault";
// Bumped to v3 when we added the `vaults` registry. All helpers
// (vault-handle-storage, git/config-storage) MUST use the same version
// so they upgrade in lockstep — opening v2 while another module wants v3
// triggers an indefinite hang.
const DB_VERSION = 3;
const STORE_NAME = "handles";
const VAULTS_STORE = "vaults";
const HANDLE_KEY = "vaultHandle";
const ACTIVE_ID_KEY = "activeVaultId";

/** Public record describing one known vault. */
export interface VaultEntry {
  /** Stable random id assigned the first time the vault is registered. */
  id: string;
  /** Human-readable name — derived from `handle.name`, kept in sync on every touch. */
  name: string;
  /** The persisted FSA handle — usable after `verifyHandlePermission`. */
  handle: FileSystemDirectoryHandle;
  /** Epoch ms of the last time the vault was activated. Used for sort order. */
  lastOpenedAt: number;
}

function openIdb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
      if (!db.objectStoreNames.contains("git-config")) {
        db.createObjectStore("git-config");
      }
      if (!db.objectStoreNames.contains(VAULTS_STORE)) {
        db.createObjectStore(VAULTS_STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/* ── Legacy single-handle API (kept for back-compat) ──────────────────── */

/**
 * Persist the given handle as the active vault. Mirrors the entry into the
 * `vaults` registry so the switcher UI sees it on next load.
 *
 * Callers that want a stable id back should prefer {@link upsertVaultEntry}.
 */
export async function saveVaultHandle(handle: FileSystemDirectoryHandle): Promise<void> {
  const db = await openIdb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(handle, HANDLE_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  // Best-effort registry sync — never fail the caller because of it.
  try {
    const entry = await upsertVaultEntry(handle);
    await setActiveVaultId(entry.id);
  } catch (err) {
    console.warn("[vault-storage] registry sync failed", err);
  }
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
    tx.objectStore(STORE_NAME).delete(ACTIVE_ID_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/* ── Multi-vault registry ─────────────────────────────────────────────── */

/** List all known vaults, sorted by most-recently-opened first. */
export async function listVaults(): Promise<VaultEntry[]> {
  const db = await openIdb();
  const entries = await new Promise<VaultEntry[]>((resolve, reject) => {
    const tx = db.transaction(VAULTS_STORE, "readonly");
    const req = tx.objectStore(VAULTS_STORE).getAll();
    req.onsuccess = () => resolve((req.result as VaultEntry[]) ?? []);
    req.onerror = () => reject(req.error);
  });
  // Migration: if the registry is empty but the legacy slot has a handle,
  // adopt it so the user keeps their current vault on first multi-vault load.
  if (entries.length === 0) {
    const legacy = await loadVaultHandle().catch(() => null);
    if (legacy) {
      const adopted = await upsertVaultEntry(legacy);
      await setActiveVaultId(adopted.id);
      return [adopted];
    }
  }
  return entries.sort((a, b) => b.lastOpenedAt - a.lastOpenedAt);
}

export async function getVaultEntry(id: string): Promise<VaultEntry | null> {
  const db = await openIdb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(VAULTS_STORE, "readonly");
    const req = tx.objectStore(VAULTS_STORE).get(id);
    req.onsuccess = () => resolve((req.result as VaultEntry | undefined) ?? null);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Insert (or refresh) an entry for the given handle. Deduplicates via
 * `isSameEntry` so the same folder picked twice yields a single registry
 * entry. Updates `lastOpenedAt` on every call.
 */
export async function upsertVaultEntry(
  handle: FileSystemDirectoryHandle,
): Promise<VaultEntry> {
  const existing = await listVaultsRaw();
  let matched: VaultEntry | null = null;
  for (const entry of existing) {
    try {
      if (await entry.handle.isSameEntry(handle)) {
        matched = entry;
        break;
      }
    } catch {
      // isSameEntry can throw if a handle was invalidated by the browser;
      // skip such entries — they will be repaired/replaced below.
    }
  }
  const now = Date.now();
  const next: VaultEntry = matched
    ? { ...matched, handle, name: handle.name || matched.name, lastOpenedAt: now }
    : { id: genId(), name: handle.name || "Vault", handle, lastOpenedAt: now };

  const db = await openIdb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(VAULTS_STORE, "readwrite");
    tx.objectStore(VAULTS_STORE).put(next);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  return next;
}

/** Remove one entry from the registry. The legacy slot is left untouched. */
export async function removeVaultEntry(id: string): Promise<void> {
  const db = await openIdb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(VAULTS_STORE, "readwrite");
    tx.objectStore(VAULTS_STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getActiveVaultId(): Promise<string | null> {
  const db = await openIdb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const req = tx.objectStore(STORE_NAME).get(ACTIVE_ID_KEY);
    req.onsuccess = () => resolve((req.result as string | undefined) ?? null);
    req.onerror = () => reject(req.error);
  });
}

export async function setActiveVaultId(id: string): Promise<void> {
  const db = await openIdb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(id, ACTIVE_ID_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** Internal — read raw entries without triggering the legacy-migration path. */
async function listVaultsRaw(): Promise<VaultEntry[]> {
  const db = await openIdb();
  return new Promise<VaultEntry[]>((resolve, reject) => {
    const tx = db.transaction(VAULTS_STORE, "readonly");
    const req = tx.objectStore(VAULTS_STORE).getAll();
    req.onsuccess = () => resolve((req.result as VaultEntry[]) ?? []);
    req.onerror = () => reject(req.error);
  });
}

function genId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `v_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

/* ── Permission helpers ───────────────────────────────────────────────── */

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
