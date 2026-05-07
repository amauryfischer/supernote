import { describe, it, expect, vi } from "vitest";
import { isSocketAvailable } from "../src/transport/socket.js";

describe("isSocketAvailable", () => {
  it("returns false for non-existent path", () => {
    expect(isSocketAvailable("/tmp/definitely-not-existing-socket-xzy.sock")).toBe(false);
  });

  it("returns true when file exists", async () => {
    const { writeFileSync, unlinkSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");
    const sockPath = join(tmpdir(), `test-cli-${Date.now()}.sock`);
    writeFileSync(sockPath, "");
    expect(isSocketAvailable(sockPath)).toBe(true);
    unlinkSync(sockPath);
  });
});
