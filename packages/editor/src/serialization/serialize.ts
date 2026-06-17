// Blocks → Markdown serialization
// Obsidian-interoperable output

import type { Block } from "@blocknote/core";
import type { CalloutVariant } from "../types.js";
import { TEXT_COLOR_HEX, HIGHLIGHT_COLOR_HEX } from "./colors.js";

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
          // No-markdown-equivalent styles → inline HTML, which Obsidian
          // renders natively. Colors use the hex values from colors.ts so
          // the note looks the same outside Supernote; parse.ts maps the
          // hex back to the BlockNote color name on load.
          if (item.styles.underline) text = `<u>${text}</u>`;
          const colorHex = TEXT_COLOR_HEX[item.styles.textColor as string];
          if (colorHex) text = `<span style="color:${colorHex}">${text}</span>`;
          const bgHex = HIGHLIGHT_COLOR_HEX[item.styles.backgroundColor as string];
          if (bgHex) text = `<mark style="background-color:${bgHex}">${text}</mark>`;
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

    case "databaseView": {
      // Bloc Coda/Notion-like — on persiste les deux ids en tant que ligne
      // dédiée pour qu'un round-trip markdown ne perde jamais les blocs
      // insérés dans une note (sinon l'autosave réécrit la note sans les
      // blocs et le reload affiche une note vide).
      const baseId = (props.baseId as string) ?? "";
      const viewId = (props.viewId as string) ?? "";
      return `[databaseView base="${escapeAttr(baseId)}" view="${escapeAttr(viewId)}"]`;
    }

    case "doodle": {
      // Bloc croquis Excalidraw — même logique que databaseView : ligne
      // dédiée pour que le round-trip markdown préserve la scène (JSON
      // multi-KB sur une ligne, précédent existant). Scène vide sérialisée
      // quand même pour que le bloc survive au reload.
      const sceneData = (props.sceneData as string) ?? "";
      return `[doodle scene="${escapeAttr(sceneData)}"]`;
    }

    case "formula": {
      // Bloc formule (et blocs vivants countdown/progress/sparkline) — même
      // logique que databaseView : ligne dédiée pour que le round-trip
      // markdown préserve expression, type de sortie et mode d'affichage.
      const expression = (props.expression as string) ?? "";
      const outputKind = (props.outputKind as string) ?? "text";
      const display = (props.display as string) ?? "value";
      return `[formula expr="${escapeAttr(expression)}" kind="${escapeAttr(outputKind)}" display="${escapeAttr(display)}"]`;
    }

    case "googleSheet": {
      // Bloc Google Sheet — ligne dédiée comme databaseView/doodle pour que le
      // round-trip markdown préserve le bloc (URL vide sérialisée quand même).
      const url = (props.url as string) ?? "";
      return `[googleSheet url="${escapeAttr(url)}"]`;
    }

    default:
      return serializeInlineContent(block.content);
  }
}

function escapeAttr(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
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
