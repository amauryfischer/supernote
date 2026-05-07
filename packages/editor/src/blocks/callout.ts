// Callout block — info/note/warning/danger/quote variants
// Obsidian-compatible: > [!info] Title

import { createBlockSpec } from "@blocknote/core";
import type { CalloutVariant } from "../types.js";

const CALLOUT_ICONS: Record<CalloutVariant, string> = {
  info: "ℹ",
  note: "✏",
  warning: "⚠",
  danger: "🚫",
  quote: '"',
};

const CALLOUT_COLORS: Record<CalloutVariant, string> = {
  info: "var(--callout-info, #3b82f6)",
  note: "var(--callout-note, #8b5cf6)",
  warning: "var(--callout-warning, #f59e0b)",
  danger: "var(--callout-danger, #ef4444)",
  quote: "var(--callout-quote, #6b7280)",
};

const VARIANTS: CalloutVariant[] = ["info", "note", "warning", "danger", "quote"];

export const calloutBlockSpec = createBlockSpec(
  {
    type: "callout" as const,
    propSchema: {
      variant: {
        default: "info" as CalloutVariant,
        values: VARIANTS,
      },
      title: {
        default: "",
      },
    },
    content: "inline" as const,
  },
  {
    render(block, _editor) {
      const variant = (block.props.variant ?? "info") as CalloutVariant;
      const color = CALLOUT_COLORS[variant];
      const icon = CALLOUT_ICONS[variant];

      const wrapper = document.createElement("div");
      wrapper.className = `sn-callout sn-callout--${variant}`;
      wrapper.style.borderLeftColor = color;

      const header = document.createElement("div");
      header.className = "sn-callout__header";

      const iconEl = document.createElement("span");
      iconEl.className = "sn-callout__icon";
      iconEl.setAttribute("aria-hidden", "true");
      iconEl.textContent = icon;
      iconEl.style.color = color;

      const titleEl = document.createElement("span");
      titleEl.className = "sn-callout__title";
      titleEl.textContent = block.props.title || variant;
      titleEl.style.color = color;

      header.appendChild(iconEl);
      header.appendChild(titleEl);

      const content = document.createElement("div");
      content.className = "sn-callout__content";

      wrapper.appendChild(header);
      wrapper.appendChild(content);

      return { dom: wrapper, contentDOM: content };
    },

    toExternalHTML(block, _editor, _ctx) {
      const variant = (block.props.variant ?? "info") as CalloutVariant;
      const title = block.props.title || variant;

      const blockquote = document.createElement("blockquote");
      blockquote.className = `callout callout-${variant}`;

      const titleDiv = document.createElement("p");
      titleDiv.textContent = `[!${variant.toUpperCase()}] ${title}`;
      blockquote.appendChild(titleDiv);

      const contentDiv = document.createElement("div");
      blockquote.appendChild(contentDiv);

      return { dom: blockquote, contentDOM: contentDiv };
    },
  }
);
