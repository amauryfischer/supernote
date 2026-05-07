import * as React from "react";
import { nanoid } from "nanoid";
import type { NotificationPayload } from "../shared/types.js";
import { NotificationsContext } from "./NotificationsContext.js";

const IPC_CHANNEL = "notifications:push";

/** Minimal shape of Electron's ipcRenderer we depend on. */
export interface IpcRendererLike {
  on(channel: string, listener: (event: unknown, payload: NotificationPayload) => void): void;
  off(channel: string, listener: (event: unknown, payload: NotificationPayload) => void): void;
}

export interface NotificationsProviderProps {
  children: React.ReactNode;
  /** Initial notifications (e.g. loaded from main via IPC on startup). */
  initialNotifications?: NotificationPayload[];
  /** Pass electron's ipcRenderer to enable IPC bridging. */
  ipcRenderer?: IpcRendererLike;
}

export function NotificationsProvider({
  children,
  initialNotifications = [],
  ipcRenderer,
}: NotificationsProviderProps) {
  const [notifications, setNotifications] = React.useState<NotificationPayload[]>(initialNotifications);

  const push = React.useCallback((notif: NotificationPayload) => {
    setNotifications((prev) => {
      const exists = prev.some((n) => n.id === notif.id);
      if (exists) return prev;
      return [...prev, notif];
    });
  }, []);

  React.useEffect(() => {
    if (!ipcRenderer) return;
    const handler = (_event: unknown, payload: NotificationPayload) => push(payload);
    ipcRenderer.on(IPC_CHANNEL, handler);
    return () => ipcRenderer.off(IPC_CHANNEL, handler);
  }, [ipcRenderer, push]);

  const markAsRead = React.useCallback((id: string) => {
    setNotifications((prev) =>
      prev.map((n) =>
        n.id === id && !n.readAt ? { ...n, readAt: new Date().toISOString() } : n
      )
    );
  }, []);

  const markAllAsRead = React.useCallback(() => {
    const now = new Date().toISOString();
    setNotifications((prev) => prev.map((n) => (n.readAt ? n : { ...n, readAt: now })));
  }, []);

  const clear = React.useCallback((id: string) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id));
  }, []);

  const unreadCount = React.useMemo(
    () => notifications.filter((n) => !n.readAt).length,
    [notifications]
  );

  const value = React.useMemo(
    () => ({ notifications, unreadCount, markAsRead, markAllAsRead, clear, push }),
    [notifications, unreadCount, markAsRead, markAllAsRead, clear, push]
  );

  return (
    <NotificationsContext.Provider value={value}>
      {children}
    </NotificationsContext.Provider>
  );
}

/** Helper to build a NotificationPayload with sane defaults. */
export function buildNotification(
  partial: Omit<NotificationPayload, "id" | "createdAt"> & { id?: string; createdAt?: string }
): NotificationPayload {
  return {
    ...partial,
    id: partial.id ?? nanoid(),
    createdAt: partial.createdAt ?? new Date().toISOString(),
  };
}
