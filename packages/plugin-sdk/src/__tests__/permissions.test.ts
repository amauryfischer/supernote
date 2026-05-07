import { describe, it, expect } from "vitest";
import { checkPermission, getRequiredPermission } from "../host/permissions.js";
import type { PluginPermission } from "../manifest/types.js";

describe("checkPermission", () => {
  it("allows entities.list with entities:read", () => {
    const result = checkPermission("entities.list", ["entities:read"]);
    expect(result.allowed).toBe(true);
  });

  it("denies entities.list without entities:read", () => {
    const result = checkPermission("entities.list", ["entities:write"]);
    expect(result.allowed).toBe(false);
    expect(result.requiredPermission).toBe("entities:read");
  });

  it("allows entities.create with entities:write", () => {
    const result = checkPermission("entities.create", ["entities:write"]);
    expect(result.allowed).toBe(true);
  });

  it("denies entities.create without entities:write", () => {
    const result = checkPermission("entities.create", ["entities:read"]);
    expect(result.allowed).toBe(false);
  });

  it("allows ui.showNotification with notifications:show", () => {
    const result = checkPermission("ui.showNotification", [
      "notifications:show",
    ]);
    expect(result.allowed).toBe(true);
  });

  it("denies ui.showNotification without notifications:show", () => {
    const result = checkPermission("ui.showNotification", ["entities:read"]);
    expect(result.allowed).toBe(false);
    expect(result.requiredPermission).toBe("notifications:show");
  });

  it("allows network.fetch with network:fetch", () => {
    const result = checkPermission("network.fetch", ["network:fetch"]);
    expect(result.allowed).toBe(true);
  });

  it("denies unknown method with any permissions", () => {
    const permissions: PluginPermission[] = [
      "entities:read",
      "entities:write",
      "network:fetch",
    ];
    const result = checkPermission("unknown.method", permissions);
    expect(result.allowed).toBe(false);
  });

  it("allows storage.get with entities:read", () => {
    const result = checkPermission("storage.get", ["entities:read"]);
    expect(result.allowed).toBe(true);
  });

  it("allows fs.read with fs:read", () => {
    const result = checkPermission("fs.read", ["fs:read"]);
    expect(result.allowed).toBe(true);
  });

  it("denies fs.write without fs:write", () => {
    const result = checkPermission("fs.write", ["fs:read"]);
    expect(result.allowed).toBe(false);
    expect(result.requiredPermission).toBe("fs:write");
  });
});

describe("getRequiredPermission", () => {
  it("returns the correct permission for a known method", () => {
    expect(getRequiredPermission("entities.list")).toBe("entities:read");
    expect(getRequiredPermission("entities.create")).toBe("entities:write");
    expect(getRequiredPermission("ui.showNotification")).toBe(
      "notifications:show"
    );
  });

  it("returns undefined for unknown method", () => {
    expect(getRequiredPermission("no.such.method")).toBeUndefined();
  });
});
