import { useNotificationsContext } from "./NotificationsContext.js";
import type { NotificationsContextValue } from "./NotificationsContext.js";

/**
 * Hook that exposes the notification state and actions.
 * Must be used inside <NotificationsProvider>.
 */
export function useNotifications(): Omit<NotificationsContextValue, "push"> {
  const { notifications, unreadCount, markAsRead, markAllAsRead, clear } =
    useNotificationsContext();
  return { notifications, unreadCount, markAsRead, markAllAsRead, clear };
}
