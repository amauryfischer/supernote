import * as React from "react";
import type { NotificationPayload, NotificationLevel } from "../../shared/types.js";
import { useNotificationsContext } from "../NotificationsContext.js";

const levelColors: Record<NotificationLevel, string> = {
  info: "#3b82f6",
  success: "#22c55e",
  warning: "#f59e0b",
  danger: "#ef4444",
};

export type NotificationCenterFilter = "all" | "unread";

export interface NotificationCenterProps {
  open: boolean;
  onClose: () => void;
}

/**
 * NotificationCenter — slide-out panel listing all notifications.
 * Supports filtering by unread/all.
 */
export function NotificationCenter({ open, onClose }: NotificationCenterProps) {
  const { notifications, markAsRead, clear, clearAll } = useNotificationsContext();
  const [filter, setFilter] = React.useState<NotificationCenterFilter>("all");

  const visible = React.useMemo(() => {
    const sorted = [...notifications].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
    if (filter === "unread") return sorted.filter((n) => !n.readAt);
    return sorted;
  }, [notifications, filter]);

  if (!open) return null;

  return (
    <>
      <div
        aria-hidden="true"
        onClick={onClose}
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.2)",
          zIndex: 1000,
        }}
      />
      <aside
        role="dialog"
        aria-label="Notification center"
        aria-modal="true"
        style={{
          position: "fixed",
          top: 0,
          right: 0,
          height: "100%",
          width: "22rem",
          background: "#fff",
          boxShadow: "-4px 0 16px rgba(0,0,0,0.1)",
          zIndex: 1001,
          display: "flex",
          flexDirection: "column",
        }}
      >
        <header
          style={{
            padding: "1rem",
            borderBottom: "1px solid #e5e7eb",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <h2 style={{ margin: 0, fontSize: "1rem", fontWeight: 600 }}>Notifications</h2>
          <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
            <button onClick={clearAll} style={btnStyle} aria-label="Tout supprimer">
              Tout supprimer
            </button>
            <button onClick={onClose} style={btnStyle} aria-label="Close notification center">
              Close
            </button>
          </div>
        </header>

        <div style={{ padding: "0.5rem 1rem", display: "flex", gap: "0.5rem", borderBottom: "1px solid #e5e7eb" }}>
          <FilterTab active={filter === "all"} onClick={() => setFilter("all")}>All</FilterTab>
          <FilterTab active={filter === "unread"} onClick={() => setFilter("unread")}>Unread</FilterTab>
        </div>

        <ul role="list" style={{ flex: 1, overflowY: "auto", margin: 0, padding: "0.5rem", listStyle: "none" }}>
          {visible.length === 0 && (
            <li style={{ padding: "2rem", textAlign: "center", color: "#9ca3af" }}>
              No notifications
            </li>
          )}
          {visible.map((notif) => (
            <NotifItem key={notif.id} notif={notif} onRead={markAsRead} onClear={clear} />
          ))}
        </ul>
      </aside>
    </>
  );
}

interface NotifItemProps {
  notif: NotificationPayload;
  onRead: (id: string) => void;
  onClear: (id: string) => void;
}

function NotifItem({ notif, onRead, onClear }: NotifItemProps) {
  const accent = levelColors[notif.level];
  return (
    <li
      style={{
        padding: "0.75rem",
        borderRadius: "0.375rem",
        marginBottom: "0.25rem",
        background: notif.readAt ? "transparent" : "#f9fafb",
        borderLeft: `3px solid ${accent}`,
        display: "flex",
        flexDirection: "column",
        gap: "0.25rem",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <span style={{ fontSize: "0.875rem", fontWeight: notif.readAt ? 400 : 600 }}>
          {notif.title}
        </span>
        <div style={{ display: "flex", gap: "0.25rem" }}>
          {!notif.readAt && (
            <button
              onClick={() => onRead(notif.id)}
              style={iconBtnStyle}
              aria-label="Mark as read"
            >
              &#10003;
            </button>
          )}
          <button onClick={() => onClear(notif.id)} style={iconBtnStyle} aria-label="Dismiss">
            &times;
          </button>
        </div>
      </div>
      {notif.body && (
        <span style={{ fontSize: "0.75rem", color: "#6b7280" }}>{notif.body}</span>
      )}
      <span style={{ fontSize: "0.65rem", color: "#9ca3af" }}>
        {new Date(notif.createdAt).toLocaleString()}
      </span>
    </li>
  );
}

interface FilterTabProps {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}

function FilterTab({ active, onClick, children }: FilterTabProps) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      style={{
        ...btnStyle,
        fontWeight: active ? 600 : 400,
        borderBottom: active ? "2px solid #3b82f6" : "2px solid transparent",
        borderRadius: 0,
        color: active ? "#3b82f6" : "#6b7280",
      }}
    >
      {children}
    </button>
  );
}

const btnStyle: React.CSSProperties = {
  background: "none",
  border: "none",
  cursor: "pointer",
  fontSize: "0.75rem",
  padding: "0.25rem 0.5rem",
};

const iconBtnStyle: React.CSSProperties = {
  ...btnStyle,
  lineHeight: 1,
  fontWeight: 700,
  color: "#9ca3af",
};
