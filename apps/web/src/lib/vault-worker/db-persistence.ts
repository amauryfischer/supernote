/**
 * db-persistence — FSA mirror for the SQLite vault index.
 *
 * The authoritative copy of the DB lives inside the OPFS SAH pool managed by
 * the sqlite-wasm adapter (see `sqlite-adapter.ts`). For vault-folder
 * portability (Git sync, manual backups, cross-device hand-off) the worker
 * also mirrors raw SQLite bytes to `<vault>/.supernote/index.db` after every
 * mutation and reads them back when a fresh device first opens the vault.
 *
 * OPFS itself is no longer used as a *secondary* persistence layer — that
 * role moved into the SAH pool VFS. The OPFS helpers from the old sql.js
 * setup (which serialized the whole DB into a single OPFS file) are gone.
 */

import { exportBytes, importBytes, hasOpfsDb } from "./sqlite-adapter";

const VAULT_META_DIR = ".supernote";
const VAULT_DB_FILE = "index.db";

/**
 * Directory under OPFS root used by the sqlite-wasm SAH pool VFS. The pool
 * is installed with `name: "supernote-vfs"`, which by default maps to the
 * OPFS directory `.supernote-vfs`. Wiping this directory drops the entire
 * vault DB without booting the WASM module — safe to call from the main
 * thread when the user switches vaults.
 */
const OPFS_SAH_POOL_DIR = ".supernote-vfs";

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
  if (!handle) {
    console.info(
      `[persist] loadDbFromFsa: no existing ${VAULT_META_DIR}/${VAULT_DB_FILE} under ${vaultHandle.name} (first launch?)`,
    );
    return null;
  }
  try {
    const file = await handle.getFile();
    const buf = await file.arrayBuffer();
    const bytes = new Uint8Array(buf);
    if (bytes.byteLength === 0) return null;
    console.info(
      `[persist] loadDbFromFsa: read ${bytes.byteLength} bytes from ${vaultHandle.name}/${VAULT_META_DIR}/${VAULT_DB_FILE}`,
    );
    return bytes;
  } catch (err) {
    console.warn("[persist] loadDbFromFsa: read failed", err);
    return null;
  }
}

/**
 * Mirror the current DB bytes to FSA. Called after every mutation so a
 * navigation / reload right after a write doesn't lose data if the SAH pool
 * gets recreated on a different device.
 */
export async function saveDbToFsa(
  vaultHandle: FileSystemDirectoryHandle,
): Promise<void> {
  const handle = await getVaultDbHandle(vaultHandle, true);
  if (!handle) {
    console.warn(
      `[persist] saveDbToFsa: could not open ${VAULT_META_DIR}/${VAULT_DB_FILE} (no permission?). Bytes NOT written to FSA.`,
    );
    return;
  }
  const data = await exportBytes();
  const writable = await handle.createWritable();
  await writable.write(data as unknown as Uint8Array<ArrayBuffer>);
  await writable.close();
  console.info(
    `[persist] wrote ${data.byteLength} bytes to FSA at ${vaultHandle.name}/${VAULT_META_DIR}/${VAULT_DB_FILE}`,
  );
}

/**
 * Bootstrap helper: when the SAH pool has no DB but the vault folder does,
 * import the FSA bytes into OPFS so the adapter can open the existing data
 * instead of starting from a blank schema. Called once at vault init.
 */
export async function hydrateOpfsFromFsaIfNeeded(
  vaultHandle: FileSystemDirectoryHandle,
): Promise<boolean> {
  // Defensive wrapping: an uncaught error here (NotFoundError, lost FSA
  // permission, malformed mirror, …) used to abort the whole init. Hydrate
  // is an OPTIMISATION (load existing mirror into OPFS) — failure should
  // gracefully fall back to a blank DB so the worker still boots.
  try {
    if (await hasOpfsDb()) return false;
  } catch (err) {
    console.warn("[persist] hasOpfsDb threw — assuming OPFS empty", err);
  }
  let bytes: Uint8Array | null = null;
  try {
    bytes = await loadDbFromFsa(vaultHandle);
  } catch (err) {
    console.warn("[persist] loadDbFromFsa threw — skipping hydrate", err);
    return false;
  }
  if (!bytes) return false;
  try {
    await importBytes(bytes);
    console.info(`[persist] hydrated OPFS from FSA (${bytes.byteLength} bytes)`);
    return true;
  } catch (err) {
    console.warn("[persist] importBytes failed — skipping hydrate", err);
    return false;
  }
}

/**
 * Drop the OPFS-resident DB. Called from the main thread when the user
 * switches vaults so the new vault doesn't inherit the previous one's data.
 *
 * Deletes the SAH pool directory directly via the OPFS API — does NOT boot
 * the sqlite-wasm module. That's important: this is called from the React
 * vault-setup screen, and the OPFS SAH VFS itself can only be opened from a
 * dedicated worker, so reaching for the adapter here would fail.
 *
 * NOTE: the caller must ensure the vault worker has been terminated /
 * disconnected before invoking this — leftover SAH file handles would
 * otherwise keep the directory locked.
 */
/**
 * Delete the FSA-side mirror `.supernote/index.db` in the given vault
 * folder. Called from the worker on a vault switch (resetStorage:true) to
 * neutralise any pre-fix pollution left in the mirror — the next persist
 * writes a fresh clean copy. Best-effort: missing file is fine.
 */
export async function deleteFsaMirror(
  vaultHandle: FileSystemDirectoryHandle,
): Promise<void> {
  try {
    const metaDir = await vaultHandle.getDirectoryHandle(VAULT_META_DIR);
    await metaDir.removeEntry(VAULT_DB_FILE);
    console.info(
      `[persist] deleteFsaMirror: removed ${vaultHandle.name}/${VAULT_META_DIR}/${VAULT_DB_FILE}`,
    );
  } catch (err) {
    const name = (err as DOMException)?.name;
    if (name === "NotFoundError") {
      console.info(
        `[persist] deleteFsaMirror: no existing ${VAULT_META_DIR}/${VAULT_DB_FILE} to remove (fresh vault)`,
      );
      return;
    }
    console.warn("[persist] deleteFsaMirror failed (non-fatal)", err);
  }
}

export async function clearOpfsDb(): Promise<void> {
  try {
    const root = await navigator.storage.getDirectory();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (root as any)
      .removeEntry(OPFS_SAH_POOL_DIR, { recursive: true })
      .catch(() => undefined);
    console.info(`[persist] clearOpfsDb: removed OPFS dir ${OPFS_SAH_POOL_DIR}`);
  } catch (err) {
    console.warn("[persist] clearOpfsDb failed", err);
  }
}
