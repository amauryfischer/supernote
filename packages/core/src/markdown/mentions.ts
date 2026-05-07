import type { Root, Paragraph, Text, Node } from "mdast";
import type { Mention, MentionType } from "../types/index.js";

/** Regex patterns for inline mention syntax */
const EMBED_RE = /!\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;
const WIKILINK_RE = /(?<!!)\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;
const MENTION_RE = /@([A-Za-z0-9_\-\.]+)/g;
const TAG_RE = /(?<![/\w])#([A-Za-z0-9_/-]+)/g;

interface TextWithOffset {
  text: string;
  offset: number;
}

/** Walk all Text nodes in the AST and collect their text + offsets */
function collectTextNodes(ast: Root): TextWithOffset[] {
  const results: TextWithOffset[] = [];
  let globalOffset = 0;

  function walk(node: Node): void {
    if (node.type === "text") {
      const textNode = node as Text;
      results.push({ text: textNode.value, offset: globalOffset });
      globalOffset += textNode.value.length;
    } else if ("children" in node) {
      const parent = node as { children: Node[] };
      for (const child of parent.children) {
        walk(child);
      }
    }
  }

  walk(ast as unknown as Node);
  return results;
}

/**
 * Extract all mentions from a parsed markdown AST.
 * Handles: [[wikilink]], ![[embed]], @mention, #tag
 */
export function extractMentions(ast: Root): Mention[] {
  const mentions: Mention[] = [];

  // We operate on the raw serialised text of all text nodes
  const textNodes = collectTextNodes(ast);

  for (const { text, offset } of textNodes) {
    // Embeds first (must come before wikilink to avoid double-match)
    for (const m of text.matchAll(EMBED_RE)) {
      const [raw, target, alias] = m;
      mentions.push({
        type: "EMBED" as MentionType,
        raw: raw!,
        target: target!.trim(),
        alias: alias?.trim(),
        position: { start: offset + m.index!, end: offset + m.index! + raw!.length },
      });
    }

    // Wikilinks (not embeds)
    for (const m of text.matchAll(WIKILINK_RE)) {
      const [raw, target, alias] = m;
      mentions.push({
        type: "WIKILINK" as MentionType,
        raw: raw!,
        target: target!.trim(),
        alias: alias?.trim(),
        position: { start: offset + m.index!, end: offset + m.index! + raw!.length },
      });
    }

    // Entity mentions @name
    for (const m of text.matchAll(MENTION_RE)) {
      const [raw, target] = m;
      mentions.push({
        type: "MENTION_ENTITY" as MentionType,
        raw: raw!,
        target: target!,
        position: { start: offset + m.index!, end: offset + m.index! + raw!.length },
      });
    }

    // Tags #tag/subtag
    for (const m of text.matchAll(TAG_RE)) {
      const [raw, target] = m;
      mentions.push({
        type: "TAG" as MentionType,
        raw: raw!,
        target: target!,
        position: { start: offset + m.index!, end: offset + m.index! + raw!.length },
      });
    }
  }

  return mentions;
}

/**
 * Replace all occurrences of a mention target (by ID/name) in raw markdown content.
 * Handles wikilinks, embeds, and @mentions.
 */
export function replaceMention(content: string, oldId: string, newId: string): string {
  // Replace [[oldId]] and [[oldId|alias]]
  const wikiRe = new RegExp(`(!?\\[\\[)${escapeRe(oldId)}(\\|[^\\]]*)?\\]\\]`, "g");
  let result = content.replace(wikiRe, (_, prefix, alias) =>
    `${prefix}${newId}${alias ?? ""}]]`
  );

  // Replace @oldId (word boundary: followed by non-identifier character or end)
  const mentionRe = new RegExp(`@${escapeRe(oldId)}(?=[^A-Za-z0-9_.\\-]|$)`, "g");
  result = result.replace(mentionRe, `@${newId}`);

  return result;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
