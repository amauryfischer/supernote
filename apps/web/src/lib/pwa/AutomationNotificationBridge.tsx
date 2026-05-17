"use client";

/**
 * AutomationNotificationBridge — listens for `supernote:automation-notification`
 * window events dispatched by the vault worker (via browser-link) and forwards
 * each payload to:
 *   1. The in-app notification drawer (via NotificationsProvider.push).
 *   2. The OS native Notification API when the user has granted permission
 *      AND enabled `osNotifications` in settings.
 *
 * Mounted once under NotificationsProvider + SettingsProvider. Never renders.
 */

import { useEffect } from "react";
import { useNotificationsContext, buildNotification } from "@supernote/notifications/renderer";
import { useSettings } from "@/components/settings/SettingsContext";

interface AutomationNotificationDetail {
  title: string;
  body: string;
  level?: "info" | "warning" | "error";
  timestamp: string;
}

function mapLevel(level: AutomationNotificationDetail["level"]): "info" | "warning" | "danger" {
  if (level === "error") return "danger";
  if (level === "warning") return "warning";
  return "info";
}

export function AutomationNotificationBridge() {
  const { push } = useNotificationsContext();
  const { settings } = useSettings();

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<AutomationNotificationDetail>).detail;
      if (!detail) return;

      const payload = buildNotification({
        level: mapLevel(detail.level),
        title: detail.title,
        body: detail.body,
        source: "automation",
        os: settings.notifications.osNotifications,
        createdAt: detail.timestamp,
      });
      push(payload);

      if (
        settings.notifications.osNotifications &&
        typeof window !== "undefined" &&
        "Notification" in window
      ) {
        if (Notification.permission === "granted") {
          try {
            new Notification(detail.title, {
              body: detail.body,
              silent: settings.notifications.sounds === false,
              tag: `supernote-automation-${detail.timestamp}`,
            });
          } catch (err) {
            console.warn("[automation-notif] OS notification failed", err);
          }
        } else if (Notification.permission === "default") {
          // First-time prompt — non-blocking. If the user declines we never
          // re-ask; they can re-enable from the system permissions page.
          void Notification.requestPermission().then((granted) => {
            if (granted === "granted") {
              try {
                new Notification(detail.title, {
                  body: detail.body,
                  silent: settings.notifications.sounds === false,
                });
              } catch (err) {
                console.warn("[automation-notif] post-grant OS notif failed", err);
              }
            }
          });
        }
      }
    };

    window.addEventListener("supernote:automation-notification", handler);
    return () => window.removeEventListener("supernote:automation-notification", handler);
  }, [push, settings.notifications.osNotifications, settings.notifications.sounds]);

  return null;
}
