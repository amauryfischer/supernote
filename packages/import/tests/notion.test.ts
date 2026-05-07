import { describe, it, expect } from "vitest";
import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";
import { importNotion } from "../src/notion/index.js";
import { sanitizeFilename } from "../src/utils/markdown.js";
import type { ImportOptions, NoteRecord } from "../src/types.js";

const FIXTURES = path.join(import.meta.dirname, "fixtures/notion");
const EXPORT_ZIP = path.join(FIXTURES, "export.zip");

function makeTmpDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "supernote-notion-test-"));
}

function makeOpts(tmpDir: string, overrides: Partial<ImportOptions> = {}): ImportOptions {
  return {
    targetVaultRoot: tmpDir,
    defaultFolder: "Imports/Notion/",
    preserveHierarchy: true,
    dryRun: true,
    resolvers: {},
    ...overrides,
  };
}

describe("Notion utility functions", () => {
  it("sanitizeFilename removes forbidden characters", () => {
    expect(sanitizeFilename("My Page: Title?")).toBe("My Page- Title-");
  });

  it("sanitizeFilename preserves normal names", () => {
    expect(sanitizeFilename("My Notion Page")).toBe("My Notion Page");
  });

  it("sanitizeFilename truncates long names", () => {
    const long = "A".repeat(300);
    expect(sanitizeFilename(long).length).toBeLessThanOrEqual(200);
  });
});

describe("importNotion", () => {
  it("imports markdown files from ZIP in dry-run", async () => {
    const tmpDir = await makeTmpDir();
    try {
      const result = await importNotion(EXPORT_ZIP, makeOpts(tmpDir));

      expect(result.errors).toHaveLength(0);
      // export.zip has: My Notion Page.md, Sub Page.md, Single Page.md = 3 notes + 1 CSV
      expect(result.imported.notes).toBeGreaterThanOrEqual(3);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("creates files on disk in non-dry-run mode", async () => {
    const tmpDir = await makeTmpDir();
    try {
      const opts = makeOpts(tmpDir, { dryRun: false });
      await importNotion(EXPORT_ZIP, opts);

      const entries = await fs.readdir(tmpDir, { recursive: true });
      const mdFiles = (entries as string[]).filter((e) => e.endsWith(".md"));
      expect(mdFiles.length).toBeGreaterThan(0);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("calls writeNote resolver for each markdown file", async () => {
    const tmpDir = await makeTmpDir();
    const notes: NoteRecord[] = [];
    try {
      const opts: ImportOptions = {
        targetVaultRoot: tmpDir,
        defaultFolder: "Imports/Notion/",
        dryRun: false,
        resolvers: {
          writeNote: async (n) => { notes.push(n); },
        },
      };

      await importNotion(EXPORT_ZIP, opts);
      expect(notes.length).toBeGreaterThanOrEqual(3);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("adds parent backlink for sub-pages", async () => {
    const tmpDir = await makeTmpDir();
    const notes: NoteRecord[] = [];
    try {
      const opts: ImportOptions = {
        targetVaultRoot: tmpDir,
        defaultFolder: "Imports/Notion/",
        dryRun: false,
        resolvers: {
          writeNote: async (n) => { notes.push(n); },
        },
      };

      await importNotion(EXPORT_ZIP, opts);
      const subPage = notes.find((n) => n.filePath.includes("Sub Page"));
      expect(subPage?.body).toContain("[[My Notion Page]]");
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("emits warning for CSV database files", async () => {
    const tmpDir = await makeTmpDir();
    try {
      const result = await importNotion(EXPORT_ZIP, makeOpts(tmpDir));
      const hasCsvWarning = result.warnings.some((w) => w.includes("CSV"));
      expect(hasCsvWarning).toBe(true);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("maps Notion tags from frontmatter", async () => {
    const tmpDir = await makeTmpDir();
    const notes: NoteRecord[] = [];
    try {
      const opts: ImportOptions = {
        targetVaultRoot: tmpDir,
        defaultFolder: "Imports/Notion/",
        dryRun: false,
        resolvers: {
          writeNote: async (n) => { notes.push(n); },
        },
      };

      await importNotion(EXPORT_ZIP, opts);
      const mainPage = notes.find((n) => n.filePath.includes("My Notion Page.md"));
      expect(mainPage?.tags).toContain("work");
      expect(mainPage?.tags).toContain("project");
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("sets source: notion in frontmatter for markdown notes", async () => {
    const tmpDir = await makeTmpDir();
    const notes: NoteRecord[] = [];
    try {
      const opts: ImportOptions = {
        targetVaultRoot: tmpDir,
        defaultFolder: "Imports/Notion/",
        dryRun: false,
        resolvers: {
          writeNote: async (n) => { notes.push(n); },
        },
      };

      await importNotion(EXPORT_ZIP, opts);
      // Markdown notes have source=notion, CSV imports have source=notion-csv
      const mdNotes = notes.filter((n) => n.frontmatter["source"] !== "notion-csv");
      expect(mdNotes.every((n) => n.frontmatter["source"] === "notion")).toBe(true);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("returns error for non-existent ZIP", async () => {
    const tmpDir = await makeTmpDir();
    try {
      const result = await importNotion("/nonexistent/export.zip", makeOpts(tmpDir));
      expect(result.errors).toHaveLength(1);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("assigns a ULID id to each imported note", async () => {
    const tmpDir = await makeTmpDir();
    const notes: NoteRecord[] = [];
    try {
      const opts: ImportOptions = {
        targetVaultRoot: tmpDir,
        defaultFolder: "Imports/Notion/",
        dryRun: false,
        resolvers: {
          writeNote: async (n) => { notes.push(n); },
        },
      };

      await importNotion(EXPORT_ZIP, opts);
      for (const note of notes) {
        expect(note.id).toBeTruthy();
        expect(note.id.length).toBeGreaterThan(10);
      }
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("preserves hierarchy when preserveHierarchy is true", async () => {
    const tmpDir = await makeTmpDir();
    const notes: NoteRecord[] = [];
    try {
      const opts: ImportOptions = {
        targetVaultRoot: tmpDir,
        defaultFolder: "Imports/Notion/",
        preserveHierarchy: true,
        dryRun: false,
        resolvers: {
          writeNote: async (n) => { notes.push(n); },
        },
      };

      await importNotion(EXPORT_ZIP, opts);
      const subPage = notes.find((n) => n.filePath.includes("Sub Page"));
      expect(subPage?.filePath).toContain("My Notion Page");
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("imports CSV as note file with entityType suggestion", async () => {
    const tmpDir = await makeTmpDir();
    const notes: NoteRecord[] = [];
    try {
      const opts: ImportOptions = {
        targetVaultRoot: tmpDir,
        defaultFolder: "Imports/Notion/",
        dryRun: false,
        resolvers: {
          writeNote: async (n) => { notes.push(n); },
        },
      };

      await importNotion(EXPORT_ZIP, opts);
      const csvNote = notes.find((n) => n.frontmatter["source"] === "notion-csv");
      expect(csvNote).toBeTruthy();
      expect(csvNote?.tags).toContain("notion-database");
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("keeps original created/updated dates when present in frontmatter", async () => {
    const tmpDir = await makeTmpDir();
    const notes: NoteRecord[] = [];
    try {
      const opts: ImportOptions = {
        targetVaultRoot: tmpDir,
        defaultFolder: "Imports/Notion/",
        dryRun: false,
        resolvers: {
          writeNote: async (n) => { notes.push(n); },
        },
      };

      await importNotion(EXPORT_ZIP, opts);
      const main = notes.find((n) => n.filePath.includes("My Notion Page.md"));
      // gray-matter may parse ISO strings as Date objects
      const created = main?.frontmatter["created"];
      const createdStr = created instanceof Date ? created.toISOString() : String(created ?? "");
      expect(createdStr).toMatch(/^2024-01-01/);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("cleans up temp directory after import", async () => {
    const tmpDir = await makeTmpDir();
    try {
      const zipDir = path.dirname(EXPORT_ZIP);
      const before = await fs.readdir(zipDir);

      await importNotion(EXPORT_ZIP, makeOpts(tmpDir));

      const after = await fs.readdir(zipDir);
      // No extra .notion-import-* dirs should remain
      const tempDirs = after.filter((f) => f.startsWith(".notion-import-"));
      expect(tempDirs).toHaveLength(0);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});
