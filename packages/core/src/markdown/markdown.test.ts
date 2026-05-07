import { describe, it, expect } from "vitest";
import { parseMarkdownFile, serializeEntity, extractMentions, replaceMention } from "./index.js";
import type { Entity } from "../types/index.js";

// ---- Fixtures -----------------------------------------------

const RAW_MD = `---
id: 01HX2KABCDEFGHIJKLMNOPQR
type: note
created: 2026-05-07T12:00:00.000Z
updated: 2026-05-07T12:00:00.000Z
fields:
  name: My Note
  email: alice@example.com
tags:
  - project/alpha
---

Hello [[01HXABCDEF|Alice]] and ![[assets/img.png]].
See also @Jean_Dupont and #client/important.
`;

// ---- parseMarkdownFile --------------------------------------

describe("parseMarkdownFile", () => {
  it("parses frontmatter correctly", () => {
    const { frontmatter } = parseMarkdownFile(RAW_MD);
    expect(frontmatter["id"]).toBe("01HX2KABCDEFGHIJKLMNOPQR");
    expect(frontmatter["type"]).toBe("note");
    expect((frontmatter["fields"] as { name: string }).name).toBe("My Note");
  });

  it("extracts body without frontmatter delimiters", () => {
    const { body } = parseMarkdownFile(RAW_MD);
    expect(body).not.toContain("---");
    expect(body).toContain("Hello");
  });

  it("returns a valid mdast AST", () => {
    const { ast } = parseMarkdownFile(RAW_MD);
    expect(ast.type).toBe("root");
    expect(Array.isArray(ast.children)).toBe(true);
    expect(ast.children.length).toBeGreaterThan(0);
  });
});

// ---- serializeEntity + round-trip ---------------------------

describe("serializeEntity", () => {
  const entity: Entity = {
    id: "01HX2KABCDEFGHIJKLMNOPQR",
    typeId: "note",
    filePath: "Notes/my-note.md",
    fields: { name: "My Note", email: "alice@example.com" },
    body: "Body content here.",
    createdAt: new Date("2026-05-07T12:00:00Z"),
    updatedAt: new Date("2026-05-07T12:00:00Z"),
    tags: ["project/alpha"],
  };

  it("produces valid markdown with YAML frontmatter", () => {
    const md = serializeEntity(entity);
    expect(md).toContain("---");
    expect(md).toContain("id:");
    expect(md).toContain("01HX2KABCDEFGHIJKLMNOPQR");
    expect(md).toContain("Body content here.");
  });

  it("round-trips: parse after serialize recovers fields", () => {
    const md = serializeEntity(entity);
    const { frontmatter, body } = parseMarkdownFile(md);
    expect(frontmatter["id"]).toBe(entity.id);
    expect(body.trim()).toContain("Body content here.");
    const fields = frontmatter["fields"] as Record<string, string>;
    expect(fields["name"]).toBe("My Note");
    expect(fields["email"]).toBe("alice@example.com");
  });

  it("includes tags in frontmatter", () => {
    const md = serializeEntity(entity);
    expect(md).toContain("project/alpha");
  });
});

// ---- extractMentions ----------------------------------------

describe("extractMentions", () => {
  it("extracts wikilinks", () => {
    const { ast } = parseMarkdownFile(RAW_MD);
    const mentions = extractMentions(ast);
    const wikilinks = mentions.filter((m) => m.type === "WIKILINK");
    expect(wikilinks.length).toBeGreaterThan(0);
    expect(wikilinks[0]?.target).toBe("01HXABCDEF");
    expect(wikilinks[0]?.alias).toBe("Alice");
  });

  it("extracts embeds", () => {
    const { ast } = parseMarkdownFile(RAW_MD);
    const mentions = extractMentions(ast);
    const embeds = mentions.filter((m) => m.type === "EMBED");
    expect(embeds.length).toBeGreaterThan(0);
    expect(embeds[0]?.target).toBe("assets/img.png");
  });

  it("extracts @mentions", () => {
    const { ast } = parseMarkdownFile(RAW_MD);
    const mentions = extractMentions(ast);
    const entity = mentions.filter((m) => m.type === "MENTION_ENTITY");
    expect(entity.length).toBeGreaterThan(0);
    expect(entity[0]?.target).toBe("Jean_Dupont");
  });

  it("extracts #tags", () => {
    const { ast } = parseMarkdownFile(RAW_MD);
    const mentions = extractMentions(ast);
    const tags = mentions.filter((m) => m.type === "TAG");
    expect(tags.length).toBeGreaterThan(0);
    expect(tags[0]?.target).toBe("client/important");
  });

  it("finds no mentions in plain text", () => {
    const plain = "Just some plain text without special syntax.";
    const { ast } = parseMarkdownFile(plain);
    const mentions = extractMentions(ast);
    expect(mentions).toHaveLength(0);
  });
});

// ---- replaceMention -----------------------------------------

describe("replaceMention", () => {
  it("replaces wikilink by ID", () => {
    const content = "See [[old-id]] for details.";
    const result = replaceMention(content, "old-id", "new-id");
    expect(result).toBe("See [[new-id]] for details.");
  });

  it("replaces wikilink preserving alias", () => {
    const content = "See [[old-id|My Label]] for details.";
    const result = replaceMention(content, "old-id", "new-id");
    expect(result).toBe("See [[new-id|My Label]] for details.");
  });

  it("replaces embed wikilink", () => {
    const content = "![[old-id|Caption]]";
    const result = replaceMention(content, "old-id", "new-id");
    expect(result).toBe("![[new-id|Caption]]");
  });

  it("does not replace partial matches", () => {
    const content = "[[old-id-extended]] and [[old-id]]";
    const result = replaceMention(content, "old-id", "new-id");
    // Only exact target match should be replaced
    expect(result).toContain("[[new-id]]");
  });
});
