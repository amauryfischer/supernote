import { describe, it, expect } from "vitest";
import { pluginManifestSchema } from "../manifest/schema.js";
import type { PluginManifest } from "../manifest/types.js";

const validManifest: PluginManifest = {
  id: "com.example.todoplugin",
  name: "Todo Plugin",
  version: "1.0.0",
  permissions: ["entities:read", "entities:write"],
  entry: "index.js",
};

describe("pluginManifestSchema", () => {
  it("accepts a valid minimal manifest", () => {
    const result = pluginManifestSchema.safeParse(validManifest);
    expect(result.success).toBe(true);
  });

  it("accepts a full manifest with all optional fields", () => {
    const full: PluginManifest = {
      ...validManifest,
      author: { name: "Test Author", url: "https://example.com" },
      description: "A test plugin",
      permissions: ["entities:read", "entities:write", "notifications:show"],
      contributes: {
        blocks: [{ type: "todo-block", label: "Todo" }],
        slashItems: [{ id: "todo", label: "Todo", keywords: ["task"] }],
        commands: [{ id: "todo.add", label: "Add Todo" }],
        sidebarPanels: [{ id: "todos", label: "Todos" }],
        views: [{ id: "todo-view", label: "Todo View" }],
      },
      hooks: ["beforeSave", "afterSave"],
    };
    const result = pluginManifestSchema.safeParse(full);
    expect(result.success).toBe(true);
  });

  it("rejects a manifest with invalid ID format", () => {
    const result = pluginManifestSchema.safeParse({
      ...validManifest,
      id: "invalid_id",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toContain("reverse-domain");
    }
  });

  it("rejects a manifest with invalid semver version", () => {
    const result = pluginManifestSchema.safeParse({
      ...validManifest,
      version: "not-a-version",
    });
    expect(result.success).toBe(false);
  });

  it("accepts valid semver with prerelease tag", () => {
    const result = pluginManifestSchema.safeParse({
      ...validManifest,
      version: "2.1.0-beta.1",
    });
    expect(result.success).toBe(true);
  });

  it("rejects an unknown permission", () => {
    const result = pluginManifestSchema.safeParse({
      ...validManifest,
      permissions: ["entities:read", "unknown:permission"],
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty name", () => {
    const result = pluginManifestSchema.safeParse({
      ...validManifest,
      name: "",
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty entry", () => {
    const result = pluginManifestSchema.safeParse({
      ...validManifest,
      entry: "",
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid author URL", () => {
    const result = pluginManifestSchema.safeParse({
      ...validManifest,
      author: { name: "Author", url: "not-a-url" },
    });
    expect(result.success).toBe(false);
  });

  it("accepts all valid permissions", () => {
    const allPermissions = [
      "entities:read",
      "entities:write",
      "fs:read",
      "fs:write",
      "network:fetch",
      "notifications:show",
      "commands:register",
    ];
    const result = pluginManifestSchema.safeParse({
      ...validManifest,
      permissions: allPermissions,
    });
    expect(result.success).toBe(true);
  });
});
