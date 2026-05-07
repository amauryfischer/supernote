import { describe, it, expect, beforeEach, vi } from "vitest";
import { NotificationsService } from "../main/service.js";
import type { NotificationStore } from "../main/store.js";
import type { ElectronNotificationConstructor, ElectronNotificationInstance, ElectronBrowserWindow } from "../main/electron-notif.js";
import type { NotificationPayload } from "../shared/types.js";

function makeStore(initial: NotificationPayload[] = []): NotificationStore {
  let data = [...initial];
  return {
    load: () => data,
    save: (notifs) => { data = [...notifs]; },
  };
}

function makeNotifPayload(overrides: Partial<NotificationPayload> = {}): NotificationPayload {
  return {
    id: "notif-1",
    level: "info",
    title: "Hello",
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeElectronNotification(): ElectronNotificationConstructor {
  const instance: ElectronNotificationInstance = {
    on: vi.fn().mockReturnThis(),
    show: vi.fn(),
  };
  const ctor = vi.fn(() => instance) as unknown as ElectronNotificationConstructor;
  (ctor as unknown as { isSupported: () => boolean }).isSupported = vi.fn().mockReturnValue(true);
  return ctor;
}

describe("NotificationsService", () => {
  let store: NotificationStore;
  let service: NotificationsService;

  beforeEach(() => {
    store = makeStore();
    service = new NotificationsService({ store });
  });

  it("show() adds notification to list", async () => {
    const payload = makeNotifPayload({ id: "abc" });
    await service.show(payload);
    const list = service.list();
    expect(list).toHaveLength(1);
    expect(list[0]?.id).toBe("abc");
  });

  it("show() generates id if not provided", async () => {
    const payload = { ...makeNotifPayload(), id: "" };
    await service.show(payload);
    const list = service.list();
    expect(list[0]?.id).toBeTruthy();
    expect(list[0]?.id).not.toBe("");
  });

  it("show() fires registered listeners", async () => {
    const listener = vi.fn();
    service.on("notification", listener);
    const payload = makeNotifPayload({ id: "ev-1" });
    await service.show(payload);
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ id: "ev-1" }));
  });

  it("show() triggers Electron Notification when os=true", async () => {
    const ElectronNotification = makeElectronNotification();
    const svc = new NotificationsService({ store, ElectronNotification });
    const payload = makeNotifPayload({ id: "os-1", os: true });
    await svc.show(payload);
    expect(ElectronNotification).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Hello" })
    );
  });

  it("show() does NOT trigger OS notification when os is falsy", async () => {
    const ElectronNotification = makeElectronNotification();
    const svc = new NotificationsService({ store, ElectronNotification });
    const payload = makeNotifPayload({ id: "no-os", os: false });
    await svc.show(payload);
    expect(ElectronNotification).not.toHaveBeenCalled();
  });

  it("markAsRead() sets readAt on a notification", async () => {
    const payload = makeNotifPayload({ id: "read-1" });
    await service.show(payload);
    service.markAsRead("read-1");
    const notif = service.list().find((n) => n.id === "read-1");
    expect(notif?.readAt).toBeTruthy();
  });

  it("markAllAsRead() marks all as read", async () => {
    await service.show(makeNotifPayload({ id: "r-1" }));
    await service.show(makeNotifPayload({ id: "r-2" }));
    service.markAllAsRead();
    const unread = service.list({ unread: true });
    expect(unread).toHaveLength(0);
  });

  it("clear() removes a notification", async () => {
    await service.show(makeNotifPayload({ id: "del-1" }));
    await service.show(makeNotifPayload({ id: "del-2" }));
    service.clear("del-1");
    const ids = service.list().map((n) => n.id);
    expect(ids).not.toContain("del-1");
    expect(ids).toContain("del-2");
  });

  it("list() filter unread=true returns only unread", async () => {
    await service.show(makeNotifPayload({ id: "u-1" }));
    await service.show(makeNotifPayload({ id: "u-2" }));
    service.markAsRead("u-1");
    const unread = service.list({ unread: true });
    expect(unread.map((n) => n.id)).toEqual(["u-2"]);
  });

  it("list() filter limit returns last N", async () => {
    for (let i = 0; i < 5; i++) {
      await service.show(makeNotifPayload({ id: `lim-${i}` }));
    }
    const limited = service.list({ limit: 3 });
    expect(limited).toHaveLength(3);
    expect(limited[2]?.id).toBe("lim-4");
  });

  it("sendToRenderer() calls webContents.send on each window", async () => {
    const send = vi.fn();
    const win: ElectronBrowserWindow = { webContents: { send } };
    const svc = new NotificationsService({ store, getWindows: () => [win] });
    const payload = makeNotifPayload({ id: "ipc-1" });
    svc.sendToRenderer(payload);
    expect(send).toHaveBeenCalledWith("notifications:push", payload);
  });

  it("list() excludes expired notifications", async () => {
    const past = new Date(Date.now() - 10000).toISOString();
    await service.show(makeNotifPayload({ id: "exp-1", expiresAt: past }));
    await service.show(makeNotifPayload({ id: "exp-2" }));
    const list = service.list();
    expect(list.map((n) => n.id)).toEqual(["exp-2"]);
  });

  it("persists notifications across service instances", async () => {
    const persistStore: NotificationStore = (() => {
      let data: NotificationPayload[] = [];
      return {
        load: () => data,
        save: (n) => { data = [...n]; },
      };
    })();

    const svc1 = new NotificationsService({ store: persistStore });
    await svc1.show(makeNotifPayload({ id: "persist-1" }));

    const svc2 = new NotificationsService({ store: persistStore });
    expect(svc2.list().map((n) => n.id)).toContain("persist-1");
  });
});
