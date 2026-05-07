// Markdown → Blocks parsing
// Handles Obsidian-compat syntax: [[wikilinks]], ![[embeds]], @mentions, #tags, > [!callout]

import type { PartialBlock } from "@blocknote/core";
import type { CalloutVariant } from "../types.js";

// We use `any` for the inline content array type because BlockNote's
// PartialInlineContent generic is too strict for our intermediate representation.
// The actual runtime values are compatible.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyInlineItem = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyBlock = PartialBlock<any, any, any>;

const CALLOUT_VARIANTS: ReadonlySet<string> = new Set([
  "info",
  "note",
  "warning",
  "danger",
  "quote",
]);

/** Parse > [!INFO] Title header */
function parseCalloutHeader(line: string): { variant: CalloutVariant; title: string } | null {
  const match = /^>\s*\[!(\w+)\]\s*(.*)$/.exec(line);
  if (!match) return null;
  const rawVariant = match[1]!.toLowerCase();
  const variant: CalloutVariant = CALLOUT_VARIANTS.has(rawVariant)
    ? (rawVariant as CalloutVariant)
    : "info";
  return { variant, title: match[2]?.trim() ?? "" };
}

/** Parse inline content text into an array of inline items */
function parseInlineText(text: string): AnyInlineItem[] {
  const items: AnyInlineItem[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    // Wikilink: [[target]] or [[target|alias]]
    const wikilinkMatch = /^\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/.exec(remaining);
    if (wikilinkMatch) {
      const target = wikilinkMatch[1] ?? "";
      const alias = wikilinkMatch[2] ?? "";
      items.push({ type: "wikilink", props: { target, alias } });
      remaining = remaining.slice(wikilinkMatch[0].length);
      continue;
    }

    // Mention: @name (word chars and dots)
    const mentionMatch = /^@([\w.]+)/.exec(remaining);
    if (mentionMatch) {
      const name = mentionMatch[1] ?? "";
      items.push({ type: "mention", props: { id: "", name, entityType: "" } });
      remaining = remaining.slice(mentionMatch[0].length);
      continue;
    }

    // Tag: #path/sub-tag
    const tagMatch = /^#([\w/\-]+)/.exec(remaining);
    if (tagMatch) {
      const path = tagMatch[1] ?? "";
      items.push({ type: "tag", props: { path } });
      remaining = remaining.slice(tagMatch[0].length);
      continue;
    }

    // Bold: **text**
    const boldMatch = /^\*\*(.+?)\*\*/.exec(remaining);
    if (boldMatch) {
      items.push({ type: "text", text: boldMatch[1] ?? "", styles: { bold: true } });
      remaining = remaining.slice(boldMatch[0].length);
      continue;
    }

    // Italic: _text_ or *text*
    const italicMatch = /^[*_](.+?)[*_]/.exec(remaining);
    if (italicMatch) {
      items.push({ type: "text", text: italicMatch[1] ?? "", styles: { italic: true } });
      remaining = remaining.slice(italicMatch[0].length);
      continue;
    }

    // Inline code: `code`
    const codeMatch = /^`([^`]+)`/.exec(remaining);
    if (codeMatch) {
      items.push({ type: "text", text: codeMatch[1] ?? "", styles: { code: true } });
      remaining = remaining.slice(codeMatch[0].length);
      continue;
    }

    // Markdown link: [text](url)
    const linkMatch = /^\[([^\]]*)\]\(([^)]*)\)/.exec(remaining);
    if (linkMatch) {
      items.push({
        type: "link",
        href: linkMatch[2] ?? "",
        content: [{ type: "text", text: linkMatch[1] ?? "", styles: {} }],
      });
      remaining = remaining.slice(linkMatch[0].length);
      continue;
    }

    // Plain text — consume until next special char
    const plainMatch = /^[^[\]@#*_`]+/.exec(remaining) ?? /^./.exec(remaining);
    if (plainMatch) {
      items.push({ type: "text", text: plainMatch[0], styles: {} });
      remaining = remaining.slice(plainMatch[0].length);
    }
  }

  return items;
}

/** Parse a single markdown line into a block */
function parseLine(line: string): AnyBlock | null {
  // Embed: ![[target]] or ![[target|alias]]
  const embedMatch = /^!\[\[([^\]|]+)(?:\|([^\]]+))?\]\]$/.exec(line);
  if (embedMatch) {
    return {
      type: "embed",
      props: { target: embedMatch[1] ?? "", alias: embedMatch[2] ?? "" },
    };
  }

  // Horizontal rule
  if (/^---+$/.test(line)) {
    return { type: "divider" };
  }

  // Heading
  const headingMatch = /^(#{1,6})\s+(.*)$/.exec(line);
  if (headingMatch) {
    return {
      type: "heading",
      props: { level: headingMatch[1]!.length },
      content: parseInlineText(headingMatch[2] ?? ""),
    };
  }

  // Checklist — must be checked before bullet list to avoid false matches
  const checkMatch = /^[-*]\s+\[([ xX])\]\s+(.*)$/.exec(line);
  if (checkMatch) {
    return {
      type: "checkListItem",
      props: { checked: checkMatch[1]?.toLowerCase() === "x" },
      content: parseInlineText(checkMatch[2] ?? ""),
    };
  }

  // Bullet list
  const bulletMatch = /^[-*]\s+(.*)$/.exec(line);
  if (bulletMatch) {
    return { type: "bulletListItem", content: parseInlineText(bulletMatch[1] ?? "") };
  }

  // Numbered list
  const numberedMatch = /^\d+\.\s+(.*)$/.exec(line);
  if (numberedMatch) {
    return { type: "numberedListItem", content: parseInlineText(numberedMatch[1] ?? "") };
  }

  // Fenced code block marker (handled in multi-line)
  if (/^```/.test(line)) return null;

  // Blockquote
  if (line.startsWith("> ")) {
    return { type: "quote", content: parseInlineText(line.slice(2)) };
  }

  // Normal paragraph
  if (line.trim()) {
    return { type: "paragraph", content: parseInlineText(line) };
  }

  return null;
}

/** Parse full markdown into an array of PartialBlocks */
export function markdownToBlocks(markdown: string): AnyBlock[] {
  const blocks: AnyBlock[] = [];
  const lines = markdown.split("\n");
  let i = 0;

  while (i < lines.length) {
    const line = lines[i] ?? "";

    // Fenced code block
    const fenceMatch = /^```(\w*)$/.exec(line);
    if (fenceMatch) {
      const lang = fenceMatch[1] ?? "text";
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i] ?? "")) {
        codeLines.push(lines[i] ?? "");
        i++;
      }
      i++; // consume closing ```
      blocks.push({
        type: "codeHighlight",
        props: { language: lang || "text", code: codeLines.join("\n") },
      });
      continue;
    }

    // Callout header: > [!TYPE] Title
    const calloutHeader = parseCalloutHeader(line);
    if (calloutHeader) {
      const bodyLines: string[] = [];
      i++;
      while (i < lines.length && (lines[i] ?? "").startsWith("> ")) {
        bodyLines.push((lines[i] ?? "").slice(2));
        i++;
      }
      blocks.push({
        type: "callout",
        props: { variant: calloutHeader.variant, title: calloutHeader.title },
        content: bodyLines.length > 0 ? parseInlineText(bodyLines.join(" ")) : [],
      });
      continue;
    }

    // Skip blank lines
    if (!line.trim()) {
      i++;
      continue;
    }

    const block = parseLine(line);
    if (block) blocks.push(block);

    i++;
  }

  return blocks;
}
