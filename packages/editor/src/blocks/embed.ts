// Embed / Transclusion block — ![[Note]] Obsidian syntax
// Renders another note's content read-only

import { createBlockSpec } from "@blocknote/core";

export const embedBlockSpec = createBlockSpec(
  {
    type: "embed" as const,
    propSchema: {
      target: {
        default: "",
      },
      alias: {
        default: "",
      },
    },
    content: "none" as const,
  },
  {
    render(block, _editor) {
      const wrapper = document.createElement("div");
      wrapper.className = "sn-embed";
      wrapper.setAttribute("data-target", block.props.target ?? "");

      const header = document.createElement("div");
      header.className = "sn-embed__header";

      const icon = document.createElement("span");
      icon.className = "sn-embed__icon";
      icon.textContent = "↗";
      icon.setAttribute("aria-hidden", "true");

      const label = document.createElement("span");
      label.className = "sn-embed__label";
      label.textContent = block.props.alias || block.props.target || "Embed";

      header.appendChild(icon);
      header.appendChild(label);

      const content = document.createElement("div");
      content.className = "sn-embed__content sn-embed__content--loading";
      content.textContent = `Loading ![[${block.props.target}]]…`;

      wrapper.appendChild(header);
      wrapper.appendChild(content);

      return { dom: wrapper };
    },

    toExternalHTML(block, _editor, _ctx) {
      const p = document.createElement("p");
      const alias = block.props.alias;
      p.textContent = alias
        ? `![[${block.props.target}|${alias}]]`
        : `![[${block.props.target}]]`;
      return { dom: p };
    },
  }
);
