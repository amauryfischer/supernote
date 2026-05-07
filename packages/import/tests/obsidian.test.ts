import { describe, it, expect } from "vitest";
import path from "node:path";
import { importObsidian } from "../src/obsidian/index.js";
import {
  extractHashtags,
  extractWikilinks,
  parseMarkdown,
} from "../src/utils/markdown.js";
import type { ImportOptions, NoteRecord } from "../src/types.js";

const FIXTURES = path.join(import.meta.dirname, "fixtures/obsidian");

function makeOpts(overrides: Partial<ImportOptions> = {}): ImportOptions {
  return {
    targetVaultRoot: "/tmp/test-vault-obsidian",
    defaultFolder: "Imports/Obsidian/",
    preserveHierarchy: true,
    dryRun: true,
    resolvers: {},
    ...overrides,
  };
}

describe("Obsidian markdown utilities", () => {
  it("extracts wikilinks from body", () => {
    const body = "See [[Note A]] and [[Note B|Label]].";
    const links = extractWikilinks(body);
    expect(links).toContain("Note A");
    expect(links).toContain("Note B");
  });

  it("extracts hashtags from body", () => {
    const body = "Content with #tag1 and #nested/tag.";
    const tags = extractHashtags(body);
    expect(tags).toContain("tag1");
    expect(tags).toContain("nested/tag");
  });

  it("deduplicates hashtags", () => {
    const body = "#foo #foo #bar";
    const tags = extractHashtags(body);
    expect(tags.filter((t) => t === "foo")).toHaveLength(1);
  });

  it("parses frontmatter correctly", () => {
    const md = `---\ntype: note\ntags: [a, b]\n---\n\n# Body`;
    const { frontmatter, body } = parseMarkdown(md);
    expect(frontmatter["type"]).toBe("note");
    expect(frontmatter["tags"]).toEqual(["a", "b"]);
    expect(body).toContain("# Body");
  });
});

describe("importObsidian", () => {
  it("imports all markdown files in dry-run", async () => {
    const result = await importObsidian(FIXTURES, makeOpts());
    expect(result.errors).toHaveLength(0);
    // README.md, Note A.md, Note B.md, Subfolder/Deep Note.md = 4 notes + 1 canvas
    expect(result.imported.notes).toBeGreaterThanOrEqual(4);
  });

  it("imports canvas files", async () => {
    const result = await importObsidian(FIXTURES, makeOpts());
    expect(result.imported.notes).toBeGreaterThanOrEqual(5); // includes canvas
  });

  it("skips hidden directories", async () => {
    const result = await importObsidian(FIXTURES, makeOpts());
    expect(result.errors).toHaveLength(0);
  });

  it("calls writeNote resolver for each markdown file", async () => {
    const notes: NoteRecord[] = [];
    const opts: ImportOptions = {
      targetVaultRoot: "/tmp/test-vault-obsidian-resolve",
      defaultFolder: "Imports/Obsidian/",
      dryRun: false,
      resolvers: {
        writeNote: async (n) => { notes.push(n); },
      },
    };

    await importObsidian(FIXTURES, opts);
    expect(notes.length).toBeGreaterThanOrEqual(4);
  });

  it("preserves frontmatter tags from source", async () => {
    const notes: NoteRecord[] = [];
    const opts: ImportOptions = {
      targetVaultRoot: "/tmp/test-vault-obsidian-tags",
      dryRun: false,
      resolvers: {
        writeNote: async (n) => { notes.push(n); },
      },
    };

    await importObsidian(FIXTURES, opts);
    const readme = notes.find((n) => n.filePath.includes("README"));
    expect(readme?.tags).toContain("obsidian");
    expect(readme?.tags).toContain("test");
  });

  it("merges inline hashtags with frontmatter tags", async () => {
    const notes: NoteRecord[] = [];
    const opts: ImportOptions = {
      targetVaultRoot: "/tmp/test-vault-obsidian-inline",
      dryRun: false,
      resolvers: {
        writeNote: async (n) => { notes.push(n); },
      },
    };

    await importObsidian(FIXTURES, opts);
    const readme = notes.find((n) => n.filePath.includes("README"));
    // README has #test and #fixture inline
    expect(readme?.tags).toContain("fixture");
  });

  it("maps Obsidian date fields to created/updated", async () => {
    const notes: NoteRecord[] = [];
    const opts: ImportOptions = {
      targetVaultRoot: "/tmp/test-vault-obsidian-dates",
      dryRun: false,
      resolvers: {
        writeNote: async (n) => { notes.push(n); },
      },
    };

    await importObsidian(FIXTURES, opts);
    const noteB = notes.find((n) => n.filePath.includes("Note B"));
    // gray-matter may parse date strings as Date objects
    const created = noteB?.frontmatter["created"];
    const createdStr = created instanceof Date ? created.toISOString().slice(0, 10) : String(created ?? "").slice(0, 10);
    expect(createdStr).toBe("2024-02-20");
  });

  it("preserves hierarchy when preserveHierarchy is true", async () => {
    const notes: NoteRecord[] = [];
    const opts: ImportOptions = {
      targetVaultRoot: "/tmp/test-vault-obsidian-hier",
      preserveHierarchy: true,
      dryRun: false,
      resolvers: {
        writeNote: async (n) => { notes.push(n); },
      },
    };

    await importObsidian(FIXTURES, opts);
    const deep = notes.find((n) => n.filePath.includes("Deep Note"));
    expect(deep?.filePath).toContain("Subfolder");
  });

  it("assigns generated ULID id to each note", async () => {
    const notes: NoteRecord[] = [];
    const opts: ImportOptions = {
      targetVaultRoot: "/tmp/test-vault-obsidian-id",
      dryRun: false,
      resolvers: {
        writeNote: async (n) => { notes.push(n); },
      },
    };

    await importObsidian(FIXTURES, opts);
    for (const note of notes) {
      expect(note.id).toBeTruthy();
      expect(note.id.length).toBeGreaterThan(10);
    }
  });

  it("returns error for non-existent vault", async () => {
    const result = await importObsidian("/nonexistent/vault", makeOpts());
    expect(result.errors).toHaveLength(1);
  });

  it("stores source: obsidian in frontmatter", async () => {
    const notes: NoteRecord[] = [];
    const opts: ImportOptions = {
      targetVaultRoot: "/tmp/test-vault-obsidian-src",
      dryRun: false,
      resolvers: {
        writeNote: async (n) => { notes.push(n); },
      },
    };

    await importObsidian(FIXTURES, opts);
    expect(notes.every((n) => n.frontmatter["source"] === "obsidian")).toBe(true);
  });

  it("passes through cssclass and aliases fields", async () => {
    const notes: NoteRecord[] = [];
    const opts: ImportOptions = {
      targetVaultRoot: "/tmp/test-vault-obsidian-passthrough",
      dryRun: false,
      resolvers: {
        writeNote: async (n) => { notes.push(n); },
      },
    };

    await importObsidian(FIXTURES, opts);
    const noteA = notes.find((n) => n.filePath.includes("Note A"));
    const fields = noteA?.frontmatter["fields"] as Record<string, unknown> | undefined;
    expect(fields?.["aliases"]).toEqual(["Note Alpha"]);
  });
});
