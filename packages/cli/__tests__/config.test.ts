import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { homedir } from "node:os";

describe("config — resolveVaultPath", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  it("returns flag vault when provided", async () => {
    const { resolveVaultPath } = await import("../src/config/index.js");
    expect(resolveVaultPath("/flag/vault")).toBe("/flag/vault");
  });

  it("returns SUPERNOTE_VAULT env when set", async () => {
    process.env["SUPERNOTE_VAULT"] = "/env/vault";
    const { resolveVaultPath } = await import("../src/config/index.js");
    expect(resolveVaultPath()).toBe("/env/vault");
  });

  it("falls back to ~/supernote-vault when nothing configured", async () => {
    delete process.env["SUPERNOTE_VAULT"];
    vi.mock("node:fs", async (importOriginal) => {
      const actual = await importOriginal<typeof import("node:fs")>();
      return { ...actual, existsSync: () => false };
    });
    const { resolveVaultPath } = await import("../src/config/index.js");
    const result = resolveVaultPath();
    expect(result).toBe(join(homedir(), "supernote-vault"));
  });
});

describe("config — buildConfig", () => {
  it("returns correct socketPath", async () => {
    const { buildConfig } = await import("../src/config/index.js");
    const cfg = buildConfig("/my/vault");
    expect(cfg.socketPath).toContain(".supernote");
    expect(cfg.socketPath).toContain("cli.sock");
    expect(cfg.vaultPath).toBe("/my/vault");
  });

  it("populates runtimeJsonPath and configJsonPath", async () => {
    const { buildConfig } = await import("../src/config/index.js");
    const cfg = buildConfig();
    expect(cfg.runtimeJsonPath).toContain("runtime.json");
    expect(cfg.configJsonPath).toContain("config.json");
  });
});
