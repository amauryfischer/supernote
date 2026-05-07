import { describe, it, expect, vi, afterEach } from "vitest";
import type { SupernoteConfig } from "../src/config/index.js";

const makeConfig = (overrides?: Partial<SupernoteConfig>): SupernoteConfig => ({
  vaultPath: "/tmp/vault",
  socketPath: "/tmp/nonexistent.sock",
  runtimeJsonPath: "/tmp/runtime.json",
  configJsonPath: "/tmp/config.json",
  ...overrides,
});

describe("rpc client", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns ok=false when neither socket nor HTTP is available", async () => {
    const { rpc } = await import("../src/transport/client.js");
    const config = makeConfig();
    const result = await rpc(config, "notes.create", { title: "test" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("not running");
    expect(result.transport).toBe("offline");
  });
});
