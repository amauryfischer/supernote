import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { writeNoteOffline } from "../src/transport/offline.js";

const TMP_VAULT = join(tmpdir(), `supernote-cli-test-${Date.now()}`);

beforeEach(() => {
  mkdirSync(TMP_VAULT, { recursive: true });
});

afterEach(() => {
  rmSync(TMP_VAULT, { recursive: true, force: true });
});

describe("writeNoteOffline", () => {
  it("creates a markdown file in the Inbox folder", async () => {
    const result = await writeNoteOffline(TMP_VAULT, {
      id: "01HX123456",
      title: "Test Note",
      typeId: "note",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(existsSync(result.data.filePath)).toBe(true);
    expect(result.data.filePath).toContain("Inbox");
  });

  it("writes valid frontmatter with the note id", async () => {
    const result = await writeNoteOffline(TMP_VAULT, {
      id: "01HXABC",
      title: "My Meeting",
      typeId: "note",
      tags: ["work", "meeting"],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const content = readFileSync(result.data.filePath, "utf-8");
    expect(content).toContain("id: 01HXABC");
    expect(content).toContain('title: "My Meeting"');
    expect(content).toContain("type: note");
    expect(content).toContain('"work"');
    expect(content).toContain("_offline: true");
  });

  it("includes offline warning in body", async () => {
    const result = await writeNoteOffline(TMP_VAULT, {
      id: "01HX999",
      title: "Quick Note",
      typeId: "note",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const content = readFileSync(result.data.filePath, "utf-8");
    expect(content).toContain("indexed at next app start");
  });

  it("slugifies the title for the filename", async () => {
    const result = await writeNoteOffline(TMP_VAULT, {
      id: "01HXSLUG",
      title: "Jean Dupont — Contact",
      typeId: "personne",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.filePath).toMatch(/jean-dupont/);
  });

  it("returns ok=false for invalid vault path", async () => {
    const result = await writeNoteOffline("/nonexistent/vault/path/that/cannot/be/created\0null", {
      id: "01HX000",
      title: "Fail",
      typeId: "note",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.transport).toBe("offline");
  });
});
