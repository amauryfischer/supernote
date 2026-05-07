import { nanoid } from "nanoid";
import type { NotificationPayload, NotificationFilter, NotificationListener } from "../shared/types.js";
import type { NotificationStore } from "./store.js";
import { showElectronNotification, type ElectronNotificationConstructor, type ElectronBrowserWindow } from "./electron-notif.js";

const IPC_CHANNEL = "notifications:push";
const NOTIF_CLICK_CHANNEL = "notifications:clicked";

export interface NotificationsServiceDeps {
  store: NotificationStore;
  ElectronNotification?: ElectronNotificationConstructor;
  getWindows?: () => ElectronBrowserWindow[];
}

/**
 * Main-process notification service.
 * Manages in-memory + persisted notification list, OS banners, and renderer bridging.
 */
export class NotificationsService {
  private notifications: NotificationPayload[];
  private listeners: NotificationListener[] = [];

  constructor(private readonly deps: NotificationsServiceDeps) {
    this.notifications = deps.store.load();
  }

  /** Shows an OS notification (if payload.os === true) and records it in the center. */
  async show(payload: NotificationPayload): Promise<void> {
    const notif: NotificationPayload = {
      ...payload,
      id: payload.id || nanoid(),
      createdAt: payload.createdAt || new Date().toISOString(),
    };

    this.notifications.push(notif);
    this.deps.store.save(this.notifications);
    this.emit(notif);

    if (notif.os && this.deps.ElectronNotification) {
      showElectronNotification(this.deps.ElectronNotification, notif, () => {
        this.sendToRenderer({ ...notif });
        this.sendClickedEvent(notif.id);
      });
    }
  }

  /** Sends a notification directly to all renderer windows (in-app only). */
  sendToRenderer(payload: NotificationPayload): void {
    const windows = this.deps.getWindows?.() ?? [];
    for (const win of windows) {
      win.webContents.send(IPC_CHANNEL, payload);
    }
  }

  /** Returns all (or filtered) notifications. */
  list(filter?: NotificationFilter): NotificationPayload[] {
    let result = [...this.notifications];

    const now = new Date().toISOString();
    result = result.filter((n) => !n.expiresAt || n.expiresAt > now);

    if (filter?.unread) {
      result = result.filter((n) => !n.readAt);
    }

    if (filter?.limit !== undefined && filter.limit > 0) {
      result = result.slice(-filter.limit);
    }

    return result;
  }

  /** Marks a single notification as read. */
  markAsRead(id: string): void {
    const idx = this.notifications.findIndex((n) => n.id === id);
    if (idx === -1) return;
    const notif = this.notifications[idx];
    if (!notif) return;
    this.notifications[idx] = { ...notif, readAt: new Date().toISOString() };
    this.deps.store.save(this.notifications);
  }

  /** Marks all notifications as read. */
  markAllAsRead(): void {
    const now = new Date().toISOString();
    this.notifications = this.notifications.map((n) =>
      n.readAt ? n : { ...n, readAt: now }
    );
    this.deps.store.save(this.notifications);
  }

  /** Removes a notification by id. */
  clear(id: string): void {
    this.notifications = this.notifications.filter((n) => n.id !== id);
    this.deps.store.save(this.notifications);
  }

  /** Subscribe to new notification events. */
  on(_event: "notification", listener: NotificationListener): void {
    this.listeners.push(listener);
  }

  /** Removes a listener. */
  off(_event: "notification", listener: NotificationListener): void {
    this.listeners = this.listeners.filter((l) => l !== listener);
  }

  private emit(notif: NotificationPayload): void {
    for (const listener of this.listeners) {
      listener(notif);
    }
  }

  private sendClickedEvent(id: string): void {
    const windows = this.deps.getWindows?.() ?? [];
    for (const win of windows) {
      win.webContents.send(NOTIF_CLICK_CHANNEL, id);
    }
  }
}
