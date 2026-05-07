import * as React from "react";

export interface NotificationBadgeProps {
  count: number;
  max?: number;
  className?: string;
}

/**
 * NotificationBadge — numeric badge for sidebar icons.
 * Renders nothing when count is 0.
 */
export function NotificationBadge({ count, max = 99, className }: NotificationBadgeProps) {
  if (count <= 0) return null;

  const label = count > max ? `${max}+` : String(count);

  return (
    <span
      aria-label={`${count} unread notification${count === 1 ? "" : "s"}`}
      className={className}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        minWidth: "1.25rem",
        height: "1.25rem",
        padding: "0 0.3rem",
        borderRadius: "9999px",
        background: "#ef4444",
        color: "#fff",
        fontSize: "0.65rem",
        fontWeight: 700,
        lineHeight: 1,
      }}
    >
      {label}
    </span>
  );
}
