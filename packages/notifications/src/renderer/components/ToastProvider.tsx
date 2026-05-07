import * as React from "react";
import type { NotificationPayload, NotificationLevel } from "../../shared/types.js";
import { useNotificationsContext } from "../NotificationsContext.js";

const TOAST_DURATION_MS = 3000;

const levelColors: Record<NotificationLevel, { border: string; bg: string; title: string }> = {
  info:    { border: "1px solid #93c5fd", bg: "#eff6ff", title: "#1d4ed8" },
  success: { border: "1px solid #86efac", bg: "#f0fdf4", title: "#15803d" },
  warning: { border: "1px solid #fde68a", bg: "#fffbeb", title: "#b45309" },
  danger:  { border: "1px solid #fca5a5", bg: "#fef2f2", title: "#b91c1c" },
};

interface ToastItem {
  notif: NotificationPayload;
  visible: boolean;
}

/**
 * ToastProvider — renders fugitive in-app toasts (3s) for incoming notifications.
 * Wraps around the app and listens to the NotificationsContext push events.
 */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const { notifications } = useNotificationsContext();
  const [toasts, setToasts] = React.useState<ToastItem[]>([]);
  const seenIds = React.useRef<Set<string>>(new Set());

  React.useEffect(() => {
    const latest = notifications[notifications.length - 1];
    if (!latest || seenIds.current.has(latest.id)) return;
    seenIds.current.add(latest.id);
    setToasts((prev) => [...prev, { notif: latest, visible: true }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.notif.id !== latest.id));
    }, TOAST_DURATION_MS);
  }, [notifications]);

  return (
    <>
      {children}
      <div
        role="region"
        aria-label="Notifications"
        aria-live="polite"
        style={{
          position: "fixed",
          bottom: "1rem",
          right: "1rem",
          display: "flex",
          flexDirection: "column",
          gap: "0.5rem",
          zIndex: 9999,
          pointerEvents: "none",
        }}
      >
        {toasts.map(({ notif }) => (
          <Toast key={notif.id} notif={notif} />
        ))}
      </div>
    </>
  );
}

function Toast({ notif }: { notif: NotificationPayload }) {
  const colors = levelColors[notif.level];
  return (
    <div
      role="alert"
      style={{
        pointerEvents: "auto",
        width: "20rem",
        padding: "0.75rem 1rem",
        borderRadius: "0.5rem",
        border: colors.border,
        background: colors.bg,
        boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
      }}
    >
      <p style={{ margin: 0, fontSize: "0.875rem", fontWeight: 600, color: colors.title }}>
        {notif.title}
      </p>
      {notif.body && (
        <p style={{ margin: "0.25rem 0 0", fontSize: "0.75rem", color: "#6b7280" }}>
          {notif.body}
        </p>
      )}
    </div>
  );
}
