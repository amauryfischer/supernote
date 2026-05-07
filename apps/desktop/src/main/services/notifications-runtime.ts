/**
 * NotificationsRuntime — per-vault wrapper around NotificationsService.
 *
 * Instantiates the service with a file-backed store pointing to
 * <vault>/.supernote/notifications.json and bridges incoming
 * notifications to all open renderer windows.
 */

import path from "node:path";
import { BrowserWindow, Notification } from "electron";
import { NotificationsService } from "@supernote/notifications/dist/main/service";
import { FileNotificationStore } from "@supernote/notifications/dist/main/store";
import type { NotificationPayload } from "@supernote/notifications/dist/shared/types";
import { logger } from "../logger.js";

const SUPERNOTE_DIR = ".supernote";
const NOTIF_FILE = "notifications.json";

export class NotificationsRuntime {
  private service: NotificationsService | null = null;

  startForVault(vaultPath: string): NotificationsService {
    const storePath = path.join(vaultPath, SUPERNOTE_DIR, NOTIF_FILE);
    const store = new FileNotificationStore(storePath);

    this.service = new NotificationsService({
      store,
      ElectronNotification: Notification as unknown as ConstructorParameters<
        typeof NotificationsService
      >[0]["ElectronNotification"],
      getWindows: () => BrowserWindow.getAllWindows(),
    });

    logger.info("NotificationsRuntime started", { vaultPath });
    return this.service;
  }

  stopForVault(): void {
    this.service = null;
    logger.info("NotificationsRuntime stopped");
  }

  getService(): NotificationsService | null {
    return this.service;
  }

  /** Convenience method — sends a notification payload to all renderer windows. */
  push(payload: NotificationPayload): void {
    if (!this.service) {
      logger.warn("NotificationsRuntime.push: no active service");
      return;
    }
    void this.service.show(payload).catch((err: unknown) => {
      logger.error("NotificationsRuntime.push failed", { err: String(err) });
    });
  }
}
