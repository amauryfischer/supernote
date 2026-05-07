import { describe, it, expect, beforeEach, vi } from "vitest";
import * as fs from "node:fs";
import { FileNotificationStore } from "../main/store.js";
import type { NotificationPayload } from "../shared/types.js";

vi.mock("node:fs");

const mockFs = vi.mocked(fs);

function makeNotif(overrides: Partial<NotificationPayload> = {}): NotificationPayload {
  return {
    id: "notif-1",
    level: "info",
    title: "Test notification",
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("FileNotificationStore", () => {
  const filePath = "/fake/userData/notifications.json";
  let store: FileNotificationStore;

  beforeEach(() => {
    vi.resetAllMocks();
    store = new FileNotificationStore(filePath);
  });

  it("returns empty array when file does not exist", () => {
    mockFs.existsSync.mockReturnValue(false);
    expect(store.load()).toEqual([]);
  });

  it("loads notifications from existing file", () => {
    const notifs = [makeNotif()];
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readFileSync.mockReturnValue(JSON.stringify(notifs));
    expect(store.load()).toEqual(notifs);
  });

  it("returns empty array on malformed JSON", () => {
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readFileSync.mockReturnValue("not-json{{");
    expect(store.load()).toEqual([]);
  });

  it("returns empty array when file contains non-array JSON", () => {
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readFileSync.mockReturnValue(JSON.stringify({ foo: "bar" }));
    expect(store.load()).toEqual([]);
  });

  it("saves notifications to file, creating directory if needed", () => {
    mockFs.existsSync.mockReturnValue(false);
    const notifs = [makeNotif()];
    store.save(notifs);
    expect(mockFs.mkdirSync).toHaveBeenCalledWith(expect.any(String), { recursive: true });
    expect(mockFs.writeFileSync).toHaveBeenCalledWith(
      filePath,
      JSON.stringify(notifs, null, 2),
      "utf-8"
    );
  });

  it("caps saved notifications at 1000", () => {
    mockFs.existsSync.mockReturnValue(true);
    const notifs = Array.from({ length: 1200 }, (_, i) =>
      makeNotif({ id: `notif-${i}` })
    );
    store.save(notifs);
    const written = JSON.parse((mockFs.writeFileSync.mock.calls[0]?.[1] as string) ?? "[]");
    expect(written).toHaveLength(1000);
    // Should keep the last 1000
    expect((written[0] as NotificationPayload).id).toBe("notif-200");
  });
});
