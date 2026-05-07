import * as React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { NotificationsProvider, buildNotification } from "../renderer/NotificationsProvider.js";
import { useNotifications } from "../renderer/useNotifications.js";
import { NotificationBadge } from "../renderer/components/NotificationBadge.js";
import { NotificationCenter } from "../renderer/components/NotificationCenter.js";
import { ToastProvider } from "../renderer/components/ToastProvider.js";
import type { NotificationPayload } from "../shared/types.js";

function makeNotif(overrides: Partial<NotificationPayload> = {}): NotificationPayload {
  return {
    id: "n-1",
    level: "info",
    title: "Hello world",
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

// ── NotificationBadge ────────────────────────────────────────────────

describe("NotificationBadge", () => {
  it("renders nothing when count is 0", () => {
    const { container } = render(<NotificationBadge count={0} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders count when > 0", () => {
    render(<NotificationBadge count={5} />);
    expect(screen.getByText("5")).toBeTruthy();
  });

  it("renders max+ when count exceeds max", () => {
    render(<NotificationBadge count={150} max={99} />);
    expect(screen.getByText("99+")).toBeTruthy();
  });

  it("has aria-label with count", () => {
    render(<NotificationBadge count={3} />);
    const badge = screen.getByLabelText("3 unread notifications");
    expect(badge).toBeTruthy();
  });
});

// ── useNotifications ─────────────────────────────────────────────────

function NotifConsumer({ onData }: { onData: (data: ReturnType<typeof useNotifications>) => void }) {
  const data = useNotifications();
  React.useEffect(() => { onData(data); });
  return null;
}

describe("useNotifications", () => {
  it("returns empty notifications by default", () => {
    let captured: ReturnType<typeof useNotifications> | null = null;
    render(
      <NotificationsProvider>
        <NotifConsumer onData={(d) => { captured = d; }} />
      </NotificationsProvider>
    );
    expect(captured?.notifications).toEqual([]);
    expect(captured?.unreadCount).toBe(0);
  });

  it("returns initialNotifications", () => {
    const initial = [makeNotif({ id: "init-1" })];
    let captured: ReturnType<typeof useNotifications> | null = null;
    render(
      <NotificationsProvider initialNotifications={initial}>
        <NotifConsumer onData={(d) => { captured = d; }} />
      </NotificationsProvider>
    );
    expect(captured?.notifications).toHaveLength(1);
    expect(captured?.unreadCount).toBe(1);
  });

  it("markAsRead() sets readAt", () => {
    const initial = [makeNotif({ id: "mark-1" })];
    let captured: ReturnType<typeof useNotifications> | null = null;
    render(
      <NotificationsProvider initialNotifications={initial}>
        <NotifConsumer onData={(d) => { captured = d; }} />
      </NotificationsProvider>
    );
    act(() => { captured?.markAsRead("mark-1"); });
    expect(captured?.notifications[0]?.readAt).toBeTruthy();
    expect(captured?.unreadCount).toBe(0);
  });

  it("markAllAsRead() marks all notifications", () => {
    const initial = [makeNotif({ id: "all-1" }), makeNotif({ id: "all-2" })];
    let captured: ReturnType<typeof useNotifications> | null = null;
    render(
      <NotificationsProvider initialNotifications={initial}>
        <NotifConsumer onData={(d) => { captured = d; }} />
      </NotificationsProvider>
    );
    act(() => { captured?.markAllAsRead(); });
    expect(captured?.unreadCount).toBe(0);
  });

  it("clear() removes the notification", () => {
    const initial = [makeNotif({ id: "clr-1" }), makeNotif({ id: "clr-2" })];
    let captured: ReturnType<typeof useNotifications> | null = null;
    render(
      <NotificationsProvider initialNotifications={initial}>
        <NotifConsumer onData={(d) => { captured = d; }} />
      </NotificationsProvider>
    );
    act(() => { captured?.clear("clr-1"); });
    expect(captured?.notifications).toHaveLength(1);
    expect(captured?.notifications[0]?.id).toBe("clr-2");
  });
});

// ── NotificationCenter ───────────────────────────────────────────────

describe("NotificationCenter", () => {
  const initial = [
    makeNotif({ id: "nc-1", title: "First notif" }),
    makeNotif({ id: "nc-2", title: "Second notif", readAt: new Date().toISOString() }),
  ];

  function renderCenter(open = true) {
    const onClose = vi.fn();
    const result = render(
      <NotificationsProvider initialNotifications={initial}>
        <NotificationCenter open={open} onClose={onClose} />
      </NotificationsProvider>
    );
    return { onClose, ...result };
  }

  it("renders nothing when closed", () => {
    renderCenter(false);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("renders dialog when open", () => {
    renderCenter();
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("shows all notifications by default", () => {
    renderCenter();
    expect(screen.getByText("First notif")).toBeTruthy();
    expect(screen.getByText("Second notif")).toBeTruthy();
  });

  it("filters to unread when tab clicked", () => {
    renderCenter();
    fireEvent.click(screen.getByText("Unread"));
    expect(screen.getByText("First notif")).toBeTruthy();
    expect(screen.queryByText("Second notif")).toBeNull();
  });

  it("calls onClose when Close button clicked", () => {
    const { onClose } = renderCenter();
    fireEvent.click(screen.getByLabelText("Close notification center"));
    expect(onClose).toHaveBeenCalled();
  });
});

// ── ToastProvider ────────────────────────────────────────────────────

describe("ToastProvider", () => {
  it("renders children", () => {
    render(
      <NotificationsProvider>
        <ToastProvider>
          <div>App content</div>
        </ToastProvider>
      </NotificationsProvider>
    );
    expect(screen.getByText("App content")).toBeTruthy();
  });
});

// ── buildNotification ────────────────────────────────────────────────

describe("buildNotification", () => {
  it("generates id and createdAt automatically", () => {
    const notif = buildNotification({ level: "success", title: "Built" });
    expect(notif.id).toBeTruthy();
    expect(notif.createdAt).toBeTruthy();
  });

  it("respects provided id and createdAt", () => {
    const createdAt = "2024-01-01T00:00:00.000Z";
    const notif = buildNotification({ id: "custom-id", level: "info", title: "Custom", createdAt });
    expect(notif.id).toBe("custom-id");
    expect(notif.createdAt).toBe(createdAt);
  });
});
