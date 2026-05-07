/**
 * FileWatcher — chokidar-based vault watcher.
 *
 * Watches the vault root, excluding .supernote/ and node_modules/.
 * Debounces events per path (100ms).
 * Compares hashes to suppress loopback from main-process writes.
 */

import { watch, type FSWatcher } from "chokidar";
import crypto from "node:crypto";
import fs from "node:fs";
import EventEmitter from "node:events";
import { logger } from "../logger.js";

export type WatchEventType =
  | "file:added"
  | "file:changed"
  | "file:removed"
  | "dir:added"
  | "dir:removed";

export interface WatchEvent {
  type: WatchEventType;
  path: string;
}

const DEBOUNCE_MS = 100;

export class FileWatcher extends EventEmitter {
  private watcher: FSWatcher | null = null;
  private debounceMap = new Map<string, ReturnType<typeof setTimeout>>();
  /** Hashes of files written by main process — used to break write loops. */
  private ownHashes = new Map<string, string>();

  start(rootPath: string): void {
    if (this.watcher) this.stop();

    this.watcher = watch(rootPath, {
      ignored: [
        /(^|[/\\])\../,
        /[/\\]\.supernote[/\\]/,
        /[/\\]node_modules[/\\]/,
      ],
      persistent: true,
      ignoreInitial: false,
      awaitWriteFinish: { stabilityThreshold: 80, pollInterval: 40 },
    });

    this.watcher
      .on("add", (p: string) => this.handlePath("file:added", p))
      .on("change", (p: string) => this.handlePath("file:changed", p))
      .on("unlink", (p: string) => this.handlePath("file:removed", p))
      .on("addDir", (p: string) => this.handlePath("dir:added", p))
      .on("unlinkDir", (p: string) => this.handlePath("dir:removed", p))
      .on("error", (err: unknown) => logger.error("Watcher error", { err: String(err) }));

    logger.info("FileWatcher started", { rootPath });
  }

  stop(): void {
    if (!this.watcher) return;
    void this.watcher.close();
    this.watcher = null;
    for (const t of this.debounceMap.values()) clearTimeout(t);
    this.debounceMap.clear();
    logger.info("FileWatcher stopped");
  }

  /** Register a hash for a file the main process is about to write. */
  registerOwnWrite(absPath: string, hash: string): void {
    this.ownHashes.set(absPath, hash);
  }

  private handlePath(type: WatchEventType, absPath: string): void {
    const prev = this.debounceMap.get(absPath);
    if (prev) clearTimeout(prev);

    const timer = setTimeout(() => {
      this.debounceMap.delete(absPath);
      if ((type === "file:changed" || type === "file:added") && this.isOwnWrite(absPath)) {
        return;
      }
      const event: WatchEvent = { type, path: absPath };
      this.emit("watch", event);
      logger.debug("WatchEvent", { type, path: absPath });
    }, DEBOUNCE_MS);

    this.debounceMap.set(absPath, timer);
  }

  private isOwnWrite(absPath: string): boolean {
    const expected = this.ownHashes.get(absPath);
    if (!expected) return false;
    try {
      const content = fs.readFileSync(absPath, "utf-8");
      const actual = crypto.createHash("sha256").update(content).digest("hex");
      if (actual === expected) {
        this.ownHashes.delete(absPath);
        return true;
      }
    } catch {
      // file may be temporarily unavailable
    }
    return false;
  }
}
