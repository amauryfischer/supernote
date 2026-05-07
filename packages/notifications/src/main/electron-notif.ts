import type { NotificationPayload } from "../shared/types.js";

/** Minimal shape of Electron's Notification class we depend on. */
export interface ElectronNotificationConstructor {
  new (options: ElectronNotificationOptions): ElectronNotificationInstance;
  isSupported(): boolean;
}

export interface ElectronNotificationOptions {
  title: string;
  body?: string;
  icon?: string;
  silent?: boolean;
}

export interface ElectronNotificationInstance {
  on(event: "click", listener: () => void): this;
  show(): void;
}

/** Minimal shape of Electron's BrowserWindow we depend on. */
export interface ElectronBrowserWindow {
  webContents: {
    send(channel: string, ...args: unknown[]): void;
  };
}

/**
 * Shows an OS-level notification via Electron.
 * Calls the `onClick` callback when the user clicks the notification.
 */
export function showElectronNotification(
  ElectronNotification: ElectronNotificationConstructor,
  payload: NotificationPayload,
  onClick?: () => void
): void {
  if (!ElectronNotification.isSupported()) return;

  const notif = new ElectronNotification({
    title: payload.title,
    body: payload.body,
    icon: payload.icon,
    silent: payload.silent ?? false,
  });

  if (onClick) {
    notif.on("click", onClick);
  }

  notif.show();
}
