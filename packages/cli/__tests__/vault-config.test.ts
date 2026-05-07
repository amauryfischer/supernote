import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { homedir } from "node:os";

describe("SUPERNOTE_DIR constants", () => {
  it("socket path ends with cli.sock", async () => {
    const { CLI_SOCK } = await import("../src/config/index.js");
    expect(CLI_SOCK).toMatch(/cli\.sock$/);
  });

  it("config.json is inside .supernote dir", async () => {
    const { CONFIG_JSON, SUPERNOTE_DIR } = await import("../src/config/index.js");
    expect(CONFIG_JSON).toContain(SUPERNOTE_DIR);
  });

  it("runtime.json is inside .supernote dir", async () => {
    const { RUNTIME_JSON, SUPERNOTE_DIR } = await import("../src/config/index.js");
    expect(RUNTIME_JSON).toContain(SUPERNOTE_DIR);
  });
});

describe("readConfigJson / readRuntimeJson", () => {
  it("returns empty object when files do not exist", async () => {
    const { readConfigJson, readRuntimeJson } = await import("../src/config/index.js");
    // These may or may not exist — just ensure they don't throw
    const cfg = readConfigJson();
    const rt = readRuntimeJson();
    expect(typeof cfg).toBe("object");
    expect(typeof rt).toBe("object");
  });
});
