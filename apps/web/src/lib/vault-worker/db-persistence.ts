/**
 * db-persistence — save/load the sql.js database to/from OPFS or FSA.
 *
 * Strategy:
 * 1. If a vault FSA handle is available, persist db as
 *    <vault>/.supernote/index.db (byte-level SQLite file).
 * 2. Fallback: use OPFS (Origin Private File System) at supernote/index.db.
 *
 * Both paths keep the raw SQLite binary so it's fully portable.
 */

import type { Database } from "sql.js";

const OPFS_DIR = "supernote";
const OPFS_FILE = "index.db";
const VAULT_META_DIR = ".supernote";
const VAULT_DB_FILE = "index.db";

// ── OPFS helpers ──────────────────────────────────────────────────────────────

async function getOpfsFile(create: boolean): Promise<FileSystemFileHandle | null> {
  try {
    const root = await navigator.storage.getDirectory();
    const dir = await root.getDirectoryHandle(OPFS_DIR, { create });
    return dir.getFileHandle(OPFS_FILE, { create });
  } catch {
    return null;
  }
}

export async function loadDbFromOpfs(): Promise<Uint8Array | null> {
  const handle = await getOpfsFile(false);
  if (!handle) return null;
  try {
    const file = await handle.getFile();
    const buf = await file.arrayBuffer();
    return new Uint8Array(buf);
  } catch {
    return null;
  }
}

export async function saveDbToOpfs(db: Database): Promise<void> {
  const handle = await getOpfsFile(true);
  if (!handle) return;
  const data = db.export();
  // Use createSyncAccessHandle when available (only in dedicated workers)
  // Fallback to writable stream in regular contexts
  try {
    // createSyncAccessHandle is only available in dedicated workers
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const access = await (handle as any).createSyncAccessHandle();
    access.truncate(0);
    access.write(data, { at: 0 });
    access.flush();
    access.close();
  } catch {
    const writable = await handle.createWritable();
    await writable.write(data as unknown as Uint8Array<ArrayBuffer>);
    await writable.close();
  }
}

// ── FSA (vault folder) helpers ────────────────────────────────────────────────

async function getVaultDbHandle(
  vaultHandle: FileSystemDirectoryHandle,
  create: boolean,
): Promise<FileSystemFileHandle | null> {
  try {
    const metaDir = await vaultHandle.getDirectoryHandle(VAULT_META_DIR, { create });
    return metaDir.getFileHandle(VAULT_DB_FILE, { create });
  } catch {
    return null;
  }
}

export async function loadDbFromFsa(
  vaultHandle: FileSystemDirectoryHandle,
): Promise<Uint8Array | null> {
  const handle = await getVaultDbHandle(vaultHandle, false);
  if (!handle) return null;
  try {
    const file = await handle.getFile();
    const buf = await file.arrayBuffer();
    return new Uint8Array(buf);
  } catch {
    return null;
  }
}

export async function saveDbToFsa(
  db: Database,
  vaultHandle: FileSystemDirectoryHandle,
): Promise<void> {
  const handle = await getVaultDbHandle(vaultHandle, true);
  if (!handle) return;
  const data = db.export();
  const writable = await handle.createWritable();
  await writable.write(data as unknown as Uint8Array<ArrayBuffer>);
  await writable.close();
}
