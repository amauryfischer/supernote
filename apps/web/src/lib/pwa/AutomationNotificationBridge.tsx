"use client";

/**
 * AutomationNotificationBridge — listens for `supernote:automation-notification`
 * window events dispatched by the vault worker (via browser-link) and forwards
 * each payload to:
 *   1. The in-app notification drawer (via NotificationsProvider.push).
 *   2. The OS native Notification API when the user has granted permission
 *      AND enabled `osNotifications` in settings.
 *   3. Relaie au tiroir les push reçus pendant qu'une fenêtre est visible (message SW `PUSH_RECEIVED`).
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

interface PushPayload {
  title: string;
  body: string;
  url: string;
  tag: string;
  joinUrl: string;
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

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return undefined;
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { type?: unknown; payload?: PushPayload } | null;
      if (data?.type !== "PUSH_RECEIVED" || !data.payload) return;
      // Le moteur local a déjà posé ce rappel dans le tiroir.
      if (data.payload.tag.startsWith("reminder:")) return;
      push(
        buildNotification({
          level: "info",
          title: data.payload.title,
          body: data.payload.body,
          source: "push",
        }),
      );
    };
    navigator.serviceWorker.addEventListener("message", onMessage);
    return () => navigator.serviceWorker.removeEventListener("message", onMessage);
  }, [push]);

  return null;
}
