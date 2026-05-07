/**
 * VaultLock — multi-machine lock for a vault's .supernote/lock.json.
 *
 * On open: claims the lock or throws VAULT_LOCKED_BY_OTHER if another
 * machine holds a fresh (< STALE_THRESHOLD_MS) lock.
 * On close or crash: the lock expires naturally (stale after STALE_THRESHOLD_MS)
 * and can be force-claimed on the next open.
 *
 * Heartbeat is refreshed every HEARTBEAT_INTERVAL_MS while the vault is open.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { logger } from "../logger.js";

export interface LockData {
  pid: number;
  hostname: string;
  openedAt: string;
  lastHeartbeat: string;
}

export interface VaultLockedError {
  readonly kind: "VAULT_LOCKED_BY_OTHER";
  readonly otherHost: string;
  readonly openedAt: string;
}

const STALE_THRESHOLD_MS = 60_000;
const HEARTBEAT_INTERVAL_MS = 30_000;

export class VaultLock {
  private lockPath: string | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private readonly hostname = os.hostname();

  /** Attempt to claim the vault lock. Throws VaultLockedError if another machine holds it. */
  async acquire(supernoteDir: string): Promise<void> {
    const lockPath = path.join(supernoteDir, "lock.json");
    this.lockPath = lockPath;

    const existing = this.readLock(lockPath);
    if (existing) {
      const heartbeatAge = Date.now() - new Date(existing.lastHeartbeat).getTime();
      const isFresh = heartbeatAge < STALE_THRESHOLD_MS;
      const isOtherHost = existing.hostname !== this.hostname;

      if (isFresh && isOtherHost) {
        const err: VaultLockedError = {
          kind: "VAULT_LOCKED_BY_OTHER",
          otherHost: existing.hostname,
          openedAt: existing.openedAt,
        };
        logger.warn("VaultLock: vault is locked by another host", { kind: err.kind, otherHost: err.otherHost, openedAt: err.openedAt });
        throw err;
      }

      if (isFresh && !isOtherHost) {
        logger.debug("VaultLock: reclaiming lock from same host (previous crash?)");
      } else {
        logger.info("VaultLock: stale lock found, force-claiming", {
          age: heartbeatAge,
          oldHost: existing.hostname,
        });
      }
    }

    this.writeLock(lockPath);
    this.startHeartbeat(lockPath);
    logger.info("VaultLock acquired", { lockPath });
  }

  /** Release the lock and stop heartbeat. */
  release(): void {
    this.stopHeartbeat();
    if (this.lockPath) {
      try {
        if (fs.existsSync(this.lockPath)) {
          fs.unlinkSync(this.lockPath);
          logger.info("VaultLock released", { lockPath: this.lockPath });
        }
      } catch (err) {
        logger.warn("VaultLock: failed to remove lock file", { err: String(err) });
      }
      this.lockPath = null;
    }
  }

  private readLock(lockPath: string): LockData | null {
    try {
      if (!fs.existsSync(lockPath)) return null;
      const raw = fs.readFileSync(lockPath, "utf-8");
      return JSON.parse(raw) as LockData;
    } catch {
      return null;
    }
  }

  private writeLock(lockPath: string): void {
    const now = new Date().toISOString();
    const data: LockData = {
      pid: process.pid,
      hostname: this.hostname,
      openedAt: now,
      lastHeartbeat: now,
    };
    fs.writeFileSync(lockPath, JSON.stringify(data, null, 2), "utf-8");
  }

  private updateHeartbeat(lockPath: string): void {
    try {
      const existing = this.readLock(lockPath);
      if (!existing) return;
      const updated: LockData = { ...existing, lastHeartbeat: new Date().toISOString() };
      fs.writeFileSync(lockPath, JSON.stringify(updated, null, 2), "utf-8");
    } catch (err) {
      logger.warn("VaultLock: heartbeat write failed", { err: String(err) });
    }
  }

  private startHeartbeat(lockPath: string): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      this.updateHeartbeat(lockPath);
    }, HEARTBEAT_INTERVAL_MS);
    // unref so the timer doesn't keep the process alive
    if (this.heartbeatTimer.unref) this.heartbeatTimer.unref();
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }
}

/** Type-guard for VaultLockedError. */
export function isVaultLockedError(err: unknown): err is VaultLockedError {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as VaultLockedError).kind === "VAULT_LOCKED_BY_OTHER"
  );
}
