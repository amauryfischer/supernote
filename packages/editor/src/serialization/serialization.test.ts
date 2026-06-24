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

// ── Formula block ─────────────────────────────────────────────

describe("formula block", () => {
  it("round-trips formula block with display", () => {
    const md = '[formula expr="Today() + 7" kind="date" display="countdown"]';
    const blocks = markdownToBlocks(md);
    expect(blocks).toHaveLength(1);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const b = blocks[0] as any;
    expect(b.type).toBe("formula");
    expect(b.props.expression).toBe("Today() + 7");
    expect(b.props.outputKind).toBe("date");
    expect(b.props.display).toBe("countdown");
    const out = roundTrip(md);
    expect(out).toBe(md);
  });

  it("defaults display to value when attribute is absent (rétro-compat)", () => {
    const md = '[formula expr="1 + 1" kind="number"]';
    const blocks = markdownToBlocks(md);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const b = blocks[0] as any;
    expect(b.type).toBe("formula");
    expect(b.props.display).toBe("value");
    const out = roundTrip(md);
    expect(out).toBe('[formula expr="1 + 1" kind="number" display="value"]');
  });

  it("escapes quotes inside expression", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const blocks: any[] = [
      {
        type: "formula",
        props: { expression: 'Concat("a", "b")', outputKind: "text", display: "value" },
        content: undefined,
        children: [],
      },
    ];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const md = blocksToMarkdown(blocks as any);
    const parsed = markdownToBlocks(md);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const b = parsed[0] as any;
    expect(b.type).toBe("formula");
    expect(b.props.expression).toBe('Concat("a", "b")');
  });
});

// ── Doodle block ──────────────────────────────────────────────

describe("doodle block", () => {
  it("round-trips doodle with quotes and backslashes in the scene JSON", () => {
    // Scène Excalidraw réaliste : guillemets + backslash dans le JSON.
    const sceneData = JSON.stringify({
      elements: [{ type: "text", text: 'a "quoted" \\ backslash' }],
      appState: { viewBackgroundColor: "#ffffff" },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const blocks: any[] = [
      { type: "doodle", props: { sceneData }, content: undefined, children: [] },
    ];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const md = blocksToMarkdown(blocks as any);
    expect(md.startsWith('[doodle scene="')).toBe(true);
    const parsed = markdownToBlocks(md);
    expect(parsed).toHaveLength(1);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const b = parsed[0] as any;
    expect(b.type).toBe("doodle");
    expect(b.props.sceneData).toBe(sceneData);
  });

  it("round-trips an empty doodle (le bloc vierge survit au reload)", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const blocks: any[] = [
      { type: "doodle", props: { sceneData: "" }, content: undefined, children: [] },
    ];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const md = blocksToMarkdown(blocks as any);
    expect(md).toBe('[doodle scene=""]');
    const parsed = markdownToBlocks(md);
    expect(parsed).toHaveLength(1);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const b = parsed[0] as any;
    expect(b.type).toBe("doodle");
    expect(b.props.sceneData).toBe("");
  });

  it("parses [doodle scene=...] directly from markdown", () => {
    const md = '[doodle scene="{\\"elements\\":[]}"]';
    const blocks = markdownToBlocks(md);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const b = blocks[0] as any;
    expect(b.type).toBe("doodle");
    expect(b.props.sceneData).toBe('{"elements":[]}');
    const out = roundTrip(md);
    expect(out).toBe(md);
  });
});

// ── Google Sheet ──────────────────────────────────────────────
describe("googleSheet block", () => {
  it("round-trips une URL Google Sheet", () => {
    const url = "https://docs.google.com/spreadsheets/d/1AbC-dEf/edit#gid=42";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const blocks: any[] = [
      { type: "googleSheet", props: { url }, content: undefined, children: [] },
    ];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const md = blocksToMarkdown(blocks as any);
    expect(md).toBe(`[googleSheet url="${url}"]`);
    const parsed = markdownToBlocks(md);
    expect(parsed).toHaveLength(1);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const b = parsed[0] as any;
    expect(b.type).toBe("googleSheet");
    expect(b.props.url).toBe(url);
  });

  it("round-trips un bloc vide (survit au reload)", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const blocks: any[] = [
      { type: "googleSheet", props: { url: "" }, content: undefined, children: [] },
    ];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const md = blocksToMarkdown(blocks as any);
    expect(md).toBe('[googleSheet url=""]');
    const parsed = markdownToBlocks(md);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const b = parsed[0] as any;
    expect(b.type).toBe("googleSheet");
    expect(b.props.url).toBe("");
  });

  it("échappe les guillemets dans l'URL", () => {
    const url = 'https://docs.google.com/spreadsheets/d/x/edit?q="quote"';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const blocks: any[] = [
      { type: "googleSheet", props: { url }, content: undefined, children: [] },
    ];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const md = blocksToMarkdown(blocks as any);
    const parsed = markdownToBlocks(md);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const b = parsed[0] as any;
    expect(b.props.url).toBe(url);
  });
});

// ── Gmail Message ─────────────────────────────────────────────

describe("gmailMessage block", () => {
  it("round-trip bloc gmailMessage", () => {
    const md = '[gmail threadId="thread_abc123"]';
    const blocks = markdownToBlocks(md);
    expect(blocks).toHaveLength(1);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const b = blocks[0] as any;
    expect(b.type).toBe("gmailMessage");
    expect(b.props.threadId).toBe("thread_abc123");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const back = blocksToMarkdown(blocks as any);
    expect(back.trim()).toBe(md);
  });

  it("round-trips un threadId vide (bloc vierge survit au reload)", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const blocks: any[] = [
      { type: "gmailMessage", props: { threadId: "" }, content: undefined, children: [] },
    ];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const md = blocksToMarkdown(blocks as any);
    expect(md).toBe('[gmail threadId=""]');
    const parsed = markdownToBlocks(md);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const b = parsed[0] as any;
    expect(b.type).toBe("gmailMessage");
    expect(b.props.threadId).toBe("");
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

// ── Couleurs & souligné (HTML inline) ─────────────────────────

describe("text color / highlight / underline round-trip", () => {
  it("serializes textColor style to an inline span with hex", () => {
    const blocks = [
      {
        type: "paragraph",
        props: {},
        content: [
          { type: "text", text: "alerte", styles: { textColor: "red" } },
        ],
        children: [],
      },
    ];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const md = blocksToMarkdown(blocks as any);
    expect(md).toBe('<span style="color:#e03e3e">alerte</span>');
  });

  it("serializes backgroundColor style to <mark>", () => {
    const blocks = [
      {
        type: "paragraph",
        props: {},
        content: [
          { type: "text", text: "important", styles: { backgroundColor: "yellow" } },
        ],
        children: [],
      },
    ];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const md = blocksToMarkdown(blocks as any);
    expect(md).toBe('<mark style="background-color:#fbf3db">important</mark>');
  });

  it("round-trips text color through markdown", () => {
    const md = 'Avant <span style="color:#e03e3e">rouge</span> après';
    const blocks = markdownToBlocks(md);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const content = (blocks[0] as any).content;
    const colored = content.find((c: { text?: string }) => c.text === "rouge");
    expect(colored.styles.textColor).toBe("red");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(blocksToMarkdown(blocks as any)).toBe(md);
  });

  it("round-trips highlight through markdown", () => {
    const md = '<mark style="background-color:#fbf3db">surligné</mark>';
    const blocks = markdownToBlocks(md);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const content = (blocks[0] as any).content;
    expect(content[0].styles.backgroundColor).toBe("yellow");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(blocksToMarkdown(blocks as any)).toBe(md);
  });

  it("round-trips underline through markdown", () => {
    const md = "Un mot <u>souligné</u> ici";
    const out = roundTrip(md);
    expect(out).toBe(md);
  });

  it("keeps nested styles inside a colored span (bold + color)", () => {
    const md = '<span style="color:#0b6e99">**gras bleu**</span>';
    const blocks = markdownToBlocks(md);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const item = (blocks[0] as any).content[0];
    expect(item.styles.bold).toBe(true);
    expect(item.styles.textColor).toBe("blue");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(blocksToMarkdown(blocks as any)).toBe(md);
  });

  it("combines highlight wrapping a colored span", () => {
    const md =
      '<mark style="background-color:#fbf3db"><span style="color:#e03e3e">alerte</span></mark>';
    const blocks = markdownToBlocks(md);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const item = (blocks[0] as any).content[0];
    expect(item.styles.textColor).toBe("red");
    expect(item.styles.backgroundColor).toBe("yellow");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(blocksToMarkdown(blocks as any)).toBe(md);
  });

  it("drops the style but keeps the text for unknown hex values", () => {
    const md = '<span style="color:#123456">texte</span>';
    const blocks = markdownToBlocks(md);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const item = (blocks[0] as any).content[0];
    expect(item.text).toBe("texte");
    expect(item.styles.textColor).toBeUndefined();
  });
});
