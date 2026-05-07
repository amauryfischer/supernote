/**
 * VaultManager — manages the set of known vaults and the currently open vault.
 *
 * Vault list persisted to userData/vaults.json.
 * Each vault's SQLite db lives at <rootPath>/.supernote/index.db.
 */

import fs from "node:fs";
import path from "node:path";
import { app } from "electron";
import { ulid } from "ulid";
import type { PrismaClient } from "@supernote/db";
import { createPrismaForVault, disconnectPrisma } from "./prisma-client.js";
import { logger } from "../logger.js";

export interface VaultRecord {
  id: string;
  name: string;
  path: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

interface VaultsFile {
  vaults: VaultRecord[];
  currentVaultId: string | null;
}

const SUPERNOTE_DIR = ".supernote";

export class VaultManager {
  private vaults: VaultRecord[] = [];
  private currentVaultId: string | null = null;
  private currentPrisma: PrismaClient | null = null;
  private readonly storePath: string;

  constructor() {
    this.storePath = path.join(app.getPath("userData"), "vaults.json");
    this.load();
  }

  // ── Persistence ────────────────────────────────────────────────────────────

  private load(): void {
    try {
      if (fs.existsSync(this.storePath)) {
        const raw = fs.readFileSync(this.storePath, "utf-8");
        const data = JSON.parse(raw) as VaultsFile;
        this.vaults = data.vaults ?? [];
        this.currentVaultId = data.currentVaultId ?? null;
      }
    } catch (err) {
      logger.warn("Failed to load vaults.json, starting fresh", { err: String(err) });
      this.vaults = [];
      this.currentVaultId = null;
    }
  }

  private save(): void {
    const data: VaultsFile = {
      vaults: this.vaults,
      currentVaultId: this.currentVaultId,
    };
    fs.writeFileSync(this.storePath, JSON.stringify(data, null, 2), "utf-8");
  }

  // ── Vault directory setup ─────────────────────────────────────────────────

  private ensureVaultStructure(rootPath: string): void {
    const supernoteDir = path.join(rootPath, SUPERNOTE_DIR);
    const subdirs = [
      "schemas",
      "relations",
      "views",
      "templates",
      "automations",
      "formulas",
      "plugins",
      "themes",
    ];
    fs.mkdirSync(supernoteDir, { recursive: true });
    for (const sub of subdirs) {
      fs.mkdirSync(path.join(supernoteDir, sub), { recursive: true });
    }
    logger.info("Vault structure ensured", { rootPath });
  }

  private getDbPath(rootPath: string): string {
    return path.join(rootPath, SUPERNOTE_DIR, "index.db");
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  listVaults(): VaultRecord[] {
    return this.vaults.map((v) => ({ ...v }));
  }

  getCurrentVault(): VaultRecord | null {
    if (!this.currentVaultId) return null;
    return this.vaults.find((v) => v.id === this.currentVaultId) ?? null;
  }

  getCurrentPrisma(): PrismaClient | null {
    return this.currentPrisma;
  }

  async openVault(rootPath: string): Promise<VaultRecord> {
    const absPath = path.resolve(rootPath);

    if (!fs.existsSync(absPath)) {
      throw new Error(`Vault path does not exist: ${absPath}`);
    }

    // Close current vault first
    await this.closeVault();

    // Find or create the vault record
    let vault = this.vaults.find((v) => v.path === absPath);
    if (!vault) {
      vault = this.addVaultRecord(absPath);
    }

    this.ensureVaultStructure(absPath);

    const dbPath = this.getDbPath(absPath);
    this.currentPrisma = createPrismaForVault(dbPath);
    this.currentVaultId = vault.id;

    // Upsert the Vault row in its own SQLite database
    const now = new Date().toISOString();
    try {
      await (this.currentPrisma as PrismaClient).vault.upsert({
        where: { id: vault.id },
        update: { isActive: true, updatedAt: new Date() },
        create: {
          id: vault.id,
          name: vault.name,
          rootPath: absPath,
          isActive: true,
        },
      });
    } catch (err) {
      logger.error("Failed to upsert vault row — DB may need migration", {
        err: String(err),
      });
    }

    vault.isActive = true;
    vault.updatedAt = now;
    this.save();

    logger.info("Vault opened", { id: vault.id, path: absPath });
    return { ...vault };
  }

  async closeVault(): Promise<void> {
    if (this.currentPrisma) {
      await disconnectPrisma(this.currentPrisma);
      this.currentPrisma = null;
    }
    const current = this.getCurrentVault();
    if (current) {
      current.isActive = false;
      current.updatedAt = new Date().toISOString();
    }
    this.currentVaultId = null;
    this.save();
    logger.info("Vault closed");
  }

  addVault(rootPath: string, name?: string): VaultRecord {
    const absPath = path.resolve(rootPath);
    const existing = this.vaults.find((v) => v.path === absPath);
    if (existing) return { ...existing };
    return this.addVaultRecord(absPath, name);
  }

  removeVault(id: string): VaultRecord {
    const idx = this.vaults.findIndex((v) => v.id === id);
    if (idx === -1) throw new Error(`Vault not found: ${id}`);
    const removed = this.vaults.splice(idx, 1)[0]!;
    if (this.currentVaultId === id) {
      this.currentVaultId = null;
      void disconnectPrisma(this.currentPrisma!).then(() => {
        this.currentPrisma = null;
      });
    }
    this.save();
    return { ...removed };
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private addVaultRecord(absPath: string, name?: string): VaultRecord {
    const now = new Date().toISOString();
    const vault: VaultRecord = {
      id: ulid(),
      name: name ?? path.basename(absPath),
      path: absPath,
      isActive: false,
      createdAt: now,
      updatedAt: now,
    };
    this.vaults.push(vault);
    this.save();
    return vault;
  }
}
