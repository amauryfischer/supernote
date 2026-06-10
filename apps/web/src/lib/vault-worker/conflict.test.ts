import { describe, it, expect } from "vitest";
import { shouldPreserveConflict } from "./conflict";

// Hashes are opaque tokens here — only equality matters.
const BASE = "h-baseline"; // what we last wrote (entity.fileHash)
const DISK = "h-external"; // bytes currently on disk
const INCOMING = "h-server"; // bytes the inbound op wants to write

describe("shouldPreserveConflict", () => {
  it("preserves when disk diverged externally and the op differs from both", () => {
    expect(
      shouldPreserveConflict({ existingFileHash: BASE, diskHash: DISK, incomingHash: INCOMING }),
    ).toBe(true);
  });

  it("does not preserve without a baseline (entity never written by us)", () => {
    expect(
      shouldPreserveConflict({ existingFileHash: null, diskHash: DISK, incomingHash: INCOMING }),
    ).toBe(false);
  });

  it("does not preserve when the op merely re-applies our baseline", () => {
    expect(
      shouldPreserveConflict({ existingFileHash: BASE, diskHash: DISK, incomingHash: BASE }),
    ).toBe(false);
  });

  it("does not preserve when the disk is untouched since our last write", () => {
    // diskHash === baseline ⇒ no external edit ⇒ plain overwrite is safe.
    expect(
      shouldPreserveConflict({ existingFileHash: BASE, diskHash: BASE, incomingHash: INCOMING }),
    ).toBe(false);
  });

  it("does not preserve when the disk already equals the incoming content", () => {
    // The external edit and the server op converged on identical bytes.
    expect(
      shouldPreserveConflict({ existingFileHash: BASE, diskHash: INCOMING, incomingHash: INCOMING }),
    ).toBe(false);
  });
});
