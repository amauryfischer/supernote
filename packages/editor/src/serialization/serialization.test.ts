// Serialization round-trip tests for Supernote editor blocks
// These test the parse → serialize pipeline for all 6 custom block types

import { describe, it, expect } from "vitest";
import { markdownToBlocks } from "./parse.js";
import { blocksToMarkdown } from "./serialize.js";

// ── Helpers ──────────────────────────────────────────────────

function roundTrip(md: string): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const blocks = markdownToBlocks(md) as any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return blocksToMarkdown(blocks as any);
}

// ── Wikilink ─────────────────────────────────────────────────

describe("wikilink serialization", () => {
  it("serializes wikilink without alias", () => {
    const md = "See [[Jean Dupont]] for details.";
    const out = roundTrip(md);
    expect(out).toContain("[[Jean Dupont]]");
  });

  it("serializes wikilink with alias", () => {
    const md = "See [[Jean Dupont|Jean]] for details.";
    const out = roundTrip(md);
    expect(out).toContain("[[Jean Dupont|Jean]]");
  });
});

// ── Embed / Transclusion ──────────────────────────────────────

describe("embed block", () => {
  it("parses and serializes embed block", () => {
    const md = "![[Daily/2026-05-07]]";
    const blocks = markdownToBlocks(md);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toBeDefined();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const b = blocks[0] as any;
    expect(b.type).toBe("embed");
    expect(b.props.target).toBe("Daily/2026-05-07");
    const out = roundTrip(md);
    expect(out).toBe("![[Daily/2026-05-07]]");
  });

  it("parses embed with alias", () => {
    const md = "![[Note|My Title]]";
    const blocks = markdownToBlocks(md);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((blocks[0] as any).props.alias).toBe("My Title");
    const out = roundTrip(md);
    expect(out).toBe("![[Note|My Title]]");
  });
});

// ── Mention ───────────────────────────────────────────────────

describe("mention inline", () => {
  it("serializes @mention back to @name", () => {
    const md = "Ping @JeanDupont about this.";
    const out = roundTrip(md);
    expect(out).toContain("@JeanDupont");
  });
});

// ── Tag ───────────────────────────────────────────────────────

describe("tag inline", () => {
  it("serializes #tag back to #tag", () => {
    const md = "Categorised as #projet/supernote.";
    const out = roundTrip(md);
    expect(out).toContain("#projet/supernote");
  });

  it("handles simple tag", () => {
    const md = "Filed under #notes.";
    const out = roundTrip(md);
    expect(out).toContain("#notes");
  });
});

// ── Callout ───────────────────────────────────────────────────

describe("callout block", () => {
  it("parses > [!INFO] callout header", () => {
    const md = "> [!INFO] Welcome\n> This is the body.";
    const blocks = markdownToBlocks(md);
    expect(blocks).toHaveLength(1);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const b = blocks[0] as any;
    expect(b.type).toBe("callout");
    expect(b.props.variant).toBe("info");
    expect(b.props.title).toBe("Welcome");
  });

  it("serializes callout to Obsidian format", () => {
    const md = "> [!WARNING] Watch out\n> Be careful here.";
    const out = roundTrip(md);
    expect(out).toContain("[!WARNING]");
    expect(out).toContain("Watch out");
  });

  it("handles all callout variants", () => {
    const variants = ["INFO", "NOTE", "WARNING", "DANGER", "QUOTE"] as const;
    for (const v of variants) {
      const md = `> [!${v}] Title`;
      const blocks = markdownToBlocks(md);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const b = blocks[0] as any;
      expect(b.type).toBe("callout");
      expect(b.props.variant).toBe(v.toLowerCase());
    }
  });
});

// ── Code (highlighted) ────────────────────────────────────────

describe("code block", () => {
  it("parses fenced code block with language", () => {
    const md = "```typescript\nconst x = 1;\n```";
    const blocks = markdownToBlocks(md);
    expect(blocks).toHaveLength(1);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const b = blocks[0] as any;
    expect(b.type).toBe("codeHighlight");
    expect(b.props.language).toBe("typescript");
    expect(b.props.code).toBe("const x = 1;");
  });

  it("serializes code block back to fenced markdown", () => {
    const md = "```python\nprint('hello')\n```";
    const out = roundTrip(md);
    expect(out).toContain("```python");
    expect(out).toContain("print('hello')");
    expect(out).toContain("```");
  });

  it("handles code block without language", () => {
    const md = "```\nplain code\n```";
    const blocks = markdownToBlocks(md);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const b = blocks[0] as any;
    expect(b.type).toBe("codeHighlight");
    expect(b.props.language).toBe("text");
  });
});

// ── Standard blocks ───────────────────────────────────────────

describe("standard markdown blocks", () => {
  it("parses headings", () => {
    const blocks = markdownToBlocks("# Heading 1\n## Heading 2\n### Heading 3");
    expect(blocks[0]).toBeDefined();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((blocks[0] as any).type).toBe("heading");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((blocks[0] as any).props.level).toBe(1);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((blocks[1] as any).props.level).toBe(2);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((blocks[2] as any).props.level).toBe(3);
  });

  it("parses bullet list items", () => {
    const blocks = markdownToBlocks("- Item A\n- Item B");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((blocks[0] as any).type).toBe("bulletListItem");
  });

  it("parses numbered list items", () => {
    const blocks = markdownToBlocks("1. First\n2. Second");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((blocks[0] as any).type).toBe("numberedListItem");
  });

  it("parses checkboxes", () => {
    const blocks = markdownToBlocks("- [ ] Unchecked\n- [x] Checked");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((blocks[0] as any).type).toBe("checkListItem");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((blocks[0] as any).props.checked).toBe(false);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((blocks[1] as any).props.checked).toBe(true);
  });

  it("parses horizontal rule", () => {
    const blocks = markdownToBlocks("---");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((blocks[0] as any).type).toBe("divider");
  });
});
