// Markdown → Blocks parsing
// Handles Obsidian-compat syntax: [[wikilinks]], ![[embeds]], @mentions, #tags, > [!callout]

import type { PartialBlock } from "@blocknote/core";
import type { CalloutVariant } from "../types.js";
import { textColorFromHex, highlightColorFromHex } from "./colors.js";
import { clampHtmlHeight } from "../blocks/htmlArtifactUtils.js";

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

  // Parse a wrapped HTML segment (e.g. the inside of <span style=…>…</span>)
  // recursively and merge the wrapper's style onto every produced text item
  // — nested constructs like `<mark><span>**bold**</span></mark>` keep all
  // their styles this way.
  const pushStyled = (inner: string, styles: Record<string, unknown>) => {
    for (const it of parseInlineText(inner)) {
      if (it.type === "text") it.styles = { ...it.styles, ...styles };
      items.push(it);
    }
  };

  while (remaining.length > 0) {
    // Underline: <u>text</u> (serialized by serialize.ts — no markdown form)
    const underlineMatch = /^<u>(.+?)<\/u>/.exec(remaining);
    if (underlineMatch) {
      pushStyled(underlineMatch[1] ?? "", { underline: true });
      remaining = remaining.slice(underlineMatch[0].length);
      continue;
    }

    // Text color: <span style="color:#hex">text</span>
    const colorMatch = /^<span style="color:\s*([^">]+)">(.+?)<\/span>/.exec(remaining);
    if (colorMatch) {
      const name = textColorFromHex(colorMatch[1] ?? "");
      pushStyled(colorMatch[2] ?? "", name ? { textColor: name } : {});
      remaining = remaining.slice(colorMatch[0].length);
      continue;
    }

    // Highlight: <mark style="background-color:#hex">text</mark>
    const markMatch = /^<mark style="background-color:\s*([^">]+)">(.+?)<\/mark>/.exec(remaining);
    if (markMatch) {
      const name = highlightColorFromHex(markMatch[1] ?? "");
      pushStyled(markMatch[2] ?? "", name ? { backgroundColor: name } : {});
      remaining = remaining.slice(markMatch[0].length);
      continue;
    }
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

    // Plain text — consume until next special char (`<` included so the
    // styled-HTML matchers above get a chance mid-line)
    const plainMatch = /^[^[\]@#*_`<]+/.exec(remaining) ?? /^./.exec(remaining);
    if (plainMatch) {
      items.push({ type: "text", text: plainMatch[0], styles: {} });
      remaining = remaining.slice(plainMatch[0].length);
    }
  }

  return items;
}

/** Inverse de escapeAttr (serialize.ts) — utilisé par databaseView, formula et doodle. */
function unescapeAttr(s: string): string {
  return s.replace(/\\(.)/g, "$1");
}

/** Parse a single markdown line into a block */
function parseLine(line: string): AnyBlock | null {
  // databaseView block — sérialisé par serialize.ts en
  // `[databaseView base="..." view="..."]`. Reconnu avant tout autre
  // pattern pour qu'un round-trip markdown préserve les blocs Base
  // insérés dans une note (sinon l'autosave drop les blocs).
  const dbMatch = /^\[databaseView\s+base="((?:[^"\\]|\\.)*)"\s+view="((?:[^"\\]|\\.)*)"\]\s*$/.exec(line);
  if (dbMatch) {
    return {
      type: "databaseView",
      props: { baseId: unescapeAttr(dbMatch[1] ?? ""), viewId: unescapeAttr(dbMatch[2] ?? "") },
    };
  }

  // Bloc formula — sérialisé par serialize.ts en
  // `[formula expr="..." kind="..." display="..."]`. L'attribut display est
  // optionnel (notes antérieures aux blocs vivants) → "value" par défaut.
  const formulaMatch = /^\[formula\s+expr="((?:[^"\\]|\\.)*)"\s+kind="((?:[^"\\]|\\.)*)"(?:\s+display="((?:[^"\\]|\\.)*)")?\]\s*$/.exec(line);
  if (formulaMatch) {
    return {
      type: "formula",
      props: {
        expression: unescapeAttr(formulaMatch[1] ?? ""),
        outputKind: unescapeAttr(formulaMatch[2] ?? "text"),
        display: unescapeAttr(formulaMatch[3] ?? "value"),
      },
    };
  }

  // Bloc doodle — sérialisé par serialize.ts en `[doodle scene="..."]`.
  // Reconnu avant les patterns génériques pour que le round-trip markdown
  // préserve la scène Excalidraw (même un croquis vierge, scene="").
  const doodleMatch = /^\[doodle\s+scene="((?:[^"\\]|\\.)*)"\]\s*$/.exec(line);
  if (doodleMatch) {
    return {
      type: "doodle",
      props: { sceneData: unescapeAttr(doodleMatch[1] ?? "") },
    };
  }

  // Bloc googleSheet — sérialisé par serialize.ts en `[googleSheet url="..."]`.
  // Reconnu avant les patterns génériques pour préserver le bloc au round-trip
  // (même URL vide, url="").
  const sheetMatch = /^\[googleSheet\s+url="((?:[^"\\]|\\.)*)"\]\s*$/.exec(line);
  if (sheetMatch) {
    return {
      type: "googleSheet",
      props: { url: unescapeAttr(sheetMatch[1] ?? "") },
    };
  }

  // Bloc gmailMessage — sérialisé par serialize.ts en `[gmail threadId="..."]`.
  const gmailMatch = /^\[gmail\s+threadId="((?:[^"\\]|\\.)*)"\]\s*$/.exec(line);
  if (gmailMatch) {
    return {
      type: "gmailMessage",
      props: { threadId: unescapeAttr(gmailMatch[1] ?? "") },
    };
  }

  // Embed: ![[target]] or ![[target|alias]]
  const embedMatch = /^!\[\[([^\]|]+)(?:\|([^\]]+))?\]\]$/.exec(line);
  if (embedMatch) {
    return {
      type: "embed",
      props: { target: embedMatch[1] ?? "", alias: embedMatch[2] ?? "" },
    };
  }

  // Image: ![alt](chemin) — le chemin est relatif au coffre (pièce jointe
  // collée/déposée) ou une URL absolue ; la résolution en URL affichable est
  // déléguée à l'host via `files.resolveUrl` (BlockNote `resolveFileUrl`).
  const imageMatch = /^!\[([^\]]*)\]\(([^)]+)\)\s*$/.exec(line);
  if (imageMatch) {
    return {
      type: "image",
      props: { url: imageMatch[2] ?? "", caption: imageMatch[1] ?? "" },
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

    // Fenced code block. La clôture doit avoir AU MOINS autant de backticks que
    // l'ouverture : un artefact HTML qui contient lui-même ``` reste intact.
    const fenceMatch = /^(`{3,})([\w-]*)(?:[ \t]+([^\n]*))?$/.exec(line);
    if (fenceMatch) {
      const fence = fenceMatch[1] ?? "```";
      const lang = fenceMatch[2] ?? "text";
      const info = fenceMatch[3] ?? "";
      const closing = new RegExp(`^\`{${fence.length},}\\s*$`);
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !closing.test(lines[i] ?? "")) {
        codeLines.push(lines[i] ?? "");
        i++;
      }
      i++; // consume closing fence
      const code = codeLines.join("\n");
      // `\`\`\`html preview` → artefact rendu (bloc htmlArtifact) ; un simple
      // `\`\`\`html` reste un bloc de code coloré.
      if (lang.toLowerCase() === "html" && /\bpreview\b/.test(info)) {
        const heightMatch = /\bh=(\d+)\b/.exec(info);
        blocks.push({
          type: "htmlArtifact",
          props: {
            html: code,
            height: clampHtmlHeight(heightMatch?.[1]),
          },
        });
        continue;
      }
      blocks.push({
        type: "codeHighlight",
        props: { language: lang || "text", code },
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
