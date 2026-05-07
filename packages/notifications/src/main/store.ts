import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import type { NotificationPayload } from "../shared/types.js";

const MAX_STORED = 1000;

export interface NotificationStore {
  load(): NotificationPayload[];
  save(notifications: NotificationPayload[]): void;
}

/** File-backed persistence for notifications in userData directory. */
export class FileNotificationStore implements NotificationStore {
  constructor(private readonly filePath: string) {}

  load(): NotificationPayload[] {
    if (!existsSync(this.filePath)) return [];
    try {
      const raw = readFileSync(this.filePath, "utf-8");
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed as NotificationPayload[];
    } catch {
      return [];
    }
  }

  save(notifications: NotificationPayload[]): void {
    const dir = dirname(this.filePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    const capped = notifications.slice(-MAX_STORED);
    writeFileSync(this.filePath, JSON.stringify(capped, null, 2), "utf-8");
  }
}
