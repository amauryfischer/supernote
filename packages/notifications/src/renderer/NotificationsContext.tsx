import * as React from "react";
import type { NotificationPayload } from "../shared/types.js";

export interface NotificationsContextValue {
  notifications: NotificationPayload[];
  unreadCount: number;
  markAsRead: (id: string) => void;
  markAllAsRead: () => void;
  clear: (id: string) => void;
  clearAll: () => void;
  /** Push a notification directly into the renderer state (used by IPC listener). */
  push: (notif: NotificationPayload) => void;
}

export const NotificationsContext =
  React.createContext<NotificationsContextValue | null>(null);

export function useNotificationsContext(): NotificationsContextValue {
  const ctx = React.useContext(NotificationsContext);
  if (!ctx) {
    throw new Error("useNotifications must be used inside <NotificationsProvider>");
  }
  return ctx;
}
