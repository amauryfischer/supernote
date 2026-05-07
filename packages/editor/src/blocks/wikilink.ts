// Wikilink inline content — [[Target|Alias]] syntax
// Renders as a clickable pill

import { createInlineContentSpec } from "@blocknote/core";

export const wikilinkInlineSpec = createInlineContentSpec(
  {
    type: "wikilink" as const,
    content: "none" as const,
    propSchema: {
      target: { default: "" },
      alias: { default: "" },
    },
  },
  {
    render(inlineContent, _update, _editor) {
      const pill = document.createElement("span");
      pill.className = "sn-wikilink";
      pill.setAttribute("data-wikilink-target", inlineContent.props.target);
      pill.setAttribute("contenteditable", "false");
      pill.setAttribute("role", "link");
      pill.setAttribute("tabindex", "0");

      const label = inlineContent.props.alias || inlineContent.props.target;
      pill.textContent = `[[${label}]]`;

      pill.addEventListener("click", () => {
        const event = new CustomEvent("supernote:wikilink-click", {
          bubbles: true,
          detail: { target: inlineContent.props.target },
        });
        pill.dispatchEvent(event);
      });

      return { dom: pill };
    },

    toExternalHTML(inlineContent, _editor) {
      const a = document.createElement("a");
      a.href = `#${inlineContent.props.target}`;
      const label = inlineContent.props.alias || inlineContent.props.target;
      a.textContent = `[[${label}]]`;
      return { dom: a };
    },

    parse(el) {
      const target = el.getAttribute("data-wikilink-target");
      if (target) {
        return { target, alias: el.getAttribute("data-wikilink-alias") ?? "" };
      }
      return undefined;
    },
  }
);
