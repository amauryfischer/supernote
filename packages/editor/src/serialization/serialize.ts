// Blocks → Markdown serialization
// Obsidian-interoperable output

import type { Block } from "@blocknote/core";
import type { CalloutVariant } from "../types.js";

// We use a loose block type for our serializer since we need to handle
// both default BlockNote blocks and our custom block types.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyBlock = Block<any, any, any>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyInlineItem = any;

/** Serialize a wikilink inline content to markdown string */
function serializeWikilink(target: string, alias?: string): string {
  return alias ? `[[${target}|${alias}]]` : `[[${target}]]`;
}

/** Serialize an embed block to markdown */
function serializeEmbed(target: string, alias?: string): string {
  return alias ? `![[${target}|${alias}]]` : `![[${target}]]`;
}

/** Serialize a callout block to Obsidian callout markdown */
function serializeCalloutHeader(variant: CalloutVariant, title: string): string {
  const t = title || variant;
  return `> [!${variant.toUpperCase()}] ${t}`;
}

/** Serialize inline content items from a block to text */
function serializeInlineContent(content: AnyInlineItem): string {
  if (!content || content === undefined) return "";
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";

  return (content as AnyInlineItem[])
    .map((item: AnyInlineItem) => {
      if (!item || typeof item !== "object") return "";

      if (item.type === "text") {
        let text: string = item.text ?? "";
        // Apply styles (bold, italic, etc.)
        if (item.styles) {
          if (item.styles.bold) text = `**${text}**`;
          if (item.styles.italic) text = `_${text}_`;
          if (item.styles.code) text = `\`${text}\``;
          if (item.styles.strike) text = `~~${text}~~`;
        }
        return text;
      }

      if (item.type === "link") {
        const href: string = item.href ?? "";
        const innerText = serializeInlineContent(item.content);
        return `[${innerText}](${href})`;
      }

      if (item.type === "wikilink") {
        return serializeWikilink(item.props?.target ?? "", item.props?.alias);
      }

      if (item.type === "mention") {
        return `@${item.props?.name ?? ""}`;
      }

      if (item.type === "tag") {
        return `#${item.props?.path ?? ""}`;
      }

      return "";
    })
    .join("");
}

/** Convert a single Block to its markdown representation */
function blockToMarkdownLine(block: AnyBlock): string {
  const type = block.type as string;
  const props = block.props as Record<string, unknown>;

  switch (type) {
    case "paragraph":
      return serializeInlineContent(block.content);

    case "heading": {
      const level = (props.level as number) ?? 1;
      const prefix = "#".repeat(Math.min(level, 6));
      return `${prefix} ${serializeInlineContent(block.content)}`;
    }

    case "bulletListItem":
      return `- ${serializeInlineContent(block.content)}`;

    case "numberedListItem":
      return `1. ${serializeInlineContent(block.content)}`;

    case "checkListItem": {
      const checked = props.checked ? "x" : " ";
      return `- [${checked}] ${serializeInlineContent(block.content)}`;
    }

    case "quote":
      return `> ${serializeInlineContent(block.content)}`;

    case "callout": {
      const variant = (props.variant as CalloutVariant) ?? "info";
      const title = (props.title as string) ?? "";
      const header = serializeCalloutHeader(variant, title);
      const body = serializeInlineContent(block.content);
      return body ? `${header}\n> ${body}` : header;
    }

    case "codeHighlight": {
      const lang = (props.language as string) ?? "text";
      const code = (props.code as string) ?? "";
      return `\`\`\`${lang}\n${code}\n\`\`\``;
    }

    case "code":
    case "codeBlock": {
      const lang = (props.language as string) ?? "";
      const innerText = serializeInlineContent(block.content);
      return `\`\`\`${lang}\n${innerText}\n\`\`\``;
    }

    case "embed": {
      const target = (props.target as string) ?? "";
      const alias = (props.alias as string) ?? "";
      return serializeEmbed(target, alias || undefined);
    }

    case "image": {
      const url = (props.url as string) ?? "";
      const caption = (props.caption as string) ?? "";
      return caption ? `![${caption}](${url})` : `![](${url})`;
    }

    case "divider":
      return "---";

    default:
      return serializeInlineContent(block.content);
  }
}

/** Convert blocks to Obsidian-compatible markdown */
export function blocksToMarkdown(blocks: AnyBlock[]): string {
  const lines: string[] = [];

  for (const block of blocks) {
    const line = blockToMarkdownLine(block);
    if (line) lines.push(line);

    // Recurse into children
    if (block.children && block.children.length > 0) {
      const childMd = blocksToMarkdown(block.children as AnyBlock[]);
      // Indent children
      const indented = childMd
        .split("\n")
        .map((l) => `  ${l}`)
        .join("\n");
      if (indented.trim()) lines.push(indented);
    }
  }

  return lines.join("\n\n");
}
