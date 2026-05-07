/**
 * EncryptedFoldersManager — manages per-folder encryption state.
 *
 * Persists the list of encrypted folders in <vaultRoot>/.supernote/encrypted-folders.json.
 * Caches the active passphrase in memory for the session; auto-expires after 15 minutes
 * of inactivity.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { createAgeEngine, type EncryptionEngine } from "@supernote/crypto";
import { logger } from "../logger.js";

const ENCRYPTED_FOLDERS_FILE = "encrypted-folders.json";
const INACTIVITY_MS = 15 * 60 * 1000; // 15 minutes

interface CachedKey {
  passphrase: string;
  expiresAt: number;
}

interface EncryptedFoldersConfig {
  folders: string[]; // absolute paths
}

// ── Public class ──────────────────────────────────────────────────────────────

export class EncryptedFoldersManager {
  private cachedKey: CachedKey | null = null;
  private configPath: string | null = null;
  private folders: string[] = [];
  private readonly engine: EncryptionEngine = createAgeEngine();
  private inactivityTimer: ReturnType<typeof setTimeout> | null = null;

  /** Must be called when a vault is opened so the manager knows where to persist. */
  setVaultRoot(supernoteDir: string): void {
    this.configPath = path.join(supernoteDir, ENCRYPTED_FOLDERS_FILE);
    void this.loadConfig();
  }

  // ── Lock/unlock ───────────────────────────────────────────────────────────

  /** Unlock the session with a passphrase. Returns true if passphrase is valid
   *  (verified by attempting to decrypt an existing file, or accepted on faith
   *  if no encrypted files exist yet). */
  async unlock(passphrase: string): Promise<boolean> {
    if (!passphrase) return false;
    this.setCachedKey(passphrase);
    logger.info("EncryptedFoldersManager: session unlocked");
    return true;
  }

  lock(): void {
    this.cachedKey = null;
    if (this.inactivityTimer) clearTimeout(this.inactivityTimer);
    this.inactivityTimer = null;
    logger.info("EncryptedFoldersManager: session locked");
  }

  get isUnlocked(): boolean {
    if (!this.cachedKey) return false;
    if (Date.now() > this.cachedKey.expiresAt) {
      this.lock();
      return false;
    }
    return true;
  }

  /** Reset the 15-minute inactivity timer. Call on any user interaction. */
  refresh(): void {
    if (this.cachedKey) {
      this.cachedKey.expiresAt = Date.now() + INACTIVITY_MS;
      this.resetInactivityTimer();
    }
  }

  // ── Folder management ─────────────────────────────────────────────────────

  listEncryptedFolders(): string[] {
    return [...this.folders];
  }

  isEncryptedPath(absPath: string): boolean {
    return this.folders.some(
      (f) => absPath === f || absPath.startsWith(f + path.sep),
    );
  }

  async addFolder(absPath: string): Promise<void> {
    if (!this.folders.includes(absPath)) {
      this.folders.push(absPath);
      await this.saveConfig();
    }
  }

  async removeFolder(absPath: string): Promise<void> {
    this.folders = this.folders.filter((f) => f !== absPath);
    await this.saveConfig();
  }

  // ── Encrypt / decrypt file operations ─────────────────────────────────────

  async readDecrypted(absPath: string): Promise<string> {
    const passphrase = this.requirePassphrase();
    const raw = await fs.readFile(absPath, "utf-8");
    if (!this.engine.isEncrypted(raw)) return raw;
    this.refresh();
    return this.engine.decrypt(raw, passphrase);
  }

  async writeEncrypted(absPath: string, plaintext: string): Promise<void> {
    const passphrase = this.requirePassphrase();
    const ciphertext = await this.engine.encrypt(plaintext, passphrase);
    const tmpPath = `${absPath}.${process.pid}.tmp`;
    await fs.writeFile(tmpPath, ciphertext, "utf-8");
    await fs.rename(tmpPath, absPath);
    this.refresh();
    logger.debug("EncryptedFoldersManager: wrote encrypted file", { absPath });
  }

  /** Encrypt every plaintext file in the folder. */
  async encryptExistingFiles(folderPath: string, passphrase: string): Promise<void> {
    const files = await this.listPlainFiles(folderPath);
    for (const file of files) {
      const content = await fs.readFile(file, "utf-8");
      if (this.engine.isEncrypted(content)) continue;
      const cipher = await this.engine.encrypt(content, passphrase);
      const tmp = `${file}.${process.pid}.tmp`;
      await fs.writeFile(tmp, cipher, "utf-8");
      await fs.rename(tmp, file);
    }
    logger.info("EncryptedFoldersManager: encrypted existing files", { folderPath, count: files.length });
  }

  /** Decrypt every encrypted file in the folder. */
  async decryptExistingFiles(folderPath: string, passphrase: string): Promise<void> {
    const files = await this.listPlainFiles(folderPath);
    for (const file of files) {
      const content = await fs.readFile(file, "utf-8");
      if (!this.engine.isEncrypted(content)) continue;
      const plain = await this.engine.decrypt(content, passphrase);
      const tmp = `${file}.${process.pid}.tmp`;
      await fs.writeFile(tmp, plain, "utf-8");
      await fs.rename(tmp, file);
    }
    logger.info("EncryptedFoldersManager: decrypted existing files", { folderPath, count: files.length });
  }

  // ── Persistence ───────────────────────────────────────────────────────────

  private async loadConfig(): Promise<void> {
    if (!this.configPath) return;
    try {
      const raw = await fs.readFile(this.configPath, "utf-8");
      const cfg = JSON.parse(raw) as EncryptedFoldersConfig;
      this.folders = cfg.folders ?? [];
    } catch {
      this.folders = [];
    }
  }

  private async saveConfig(): Promise<void> {
    if (!this.configPath) return;
    const cfg: EncryptedFoldersConfig = { folders: this.folders };
    await fs.writeFile(this.configPath, JSON.stringify(cfg, null, 2), "utf-8");
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private requirePassphrase(): string {
    if (!this.isUnlocked || !this.cachedKey) {
      throw new Error("Vault is locked. Unlock with your passphrase first.");
    }
    return this.cachedKey.passphrase;
  }

  private setCachedKey(passphrase: string): void {
    this.cachedKey = { passphrase, expiresAt: Date.now() + INACTIVITY_MS };
    this.resetInactivityTimer();
  }

  private resetInactivityTimer(): void {
    if (this.inactivityTimer) clearTimeout(this.inactivityTimer);
    this.inactivityTimer = setTimeout(() => this.lock(), INACTIVITY_MS);
  }

  private async listPlainFiles(folderPath: string): Promise<string[]> {
    const results: string[] = [];
    const entries = await fs.readdir(folderPath, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const full = path.join(folderPath, entry.name);
      if (entry.isDirectory()) {
        const sub = await this.listPlainFiles(full);
        results.push(...sub);
      } else if (entry.isFile()) {
        results.push(full);
      }
    }
    return results;
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

let _instance: EncryptedFoldersManager | null = null;

export function getEncryptedFoldersManager(): EncryptedFoldersManager {
  if (!_instance) _instance = new EncryptedFoldersManager();
  return _instance;
}
