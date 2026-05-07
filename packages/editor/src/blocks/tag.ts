// Tag inline content — #tag or #path/sous-tag
// Renders as a colored pill

import { createInlineContentSpec } from "@blocknote/core";

export const tagInlineSpec = createInlineContentSpec(
  {
    type: "tag" as const,
    content: "none" as const,
    propSchema: {
      path: { default: "" },
    },
  },
  {
    render(inlineContent, _update, _editor) {
      const pill = document.createElement("span");
      pill.className = "sn-tag";
      pill.setAttribute("data-tag-path", inlineContent.props.path);
      pill.setAttribute("contenteditable", "false");
      pill.setAttribute("role", "link");
      pill.setAttribute("tabindex", "0");
      pill.textContent = `#${inlineContent.props.path}`;

      pill.addEventListener("click", () => {
        const event = new CustomEvent("supernote:tag-click", {
          bubbles: true,
          detail: { path: inlineContent.props.path },
        });
        pill.dispatchEvent(event);
      });

      return { dom: pill };
    },

    toExternalHTML(inlineContent, _editor) {
      const span = document.createElement("span");
      span.textContent = `#${inlineContent.props.path}`;
      return { dom: span };
    },

    parse(el) {
      const path = el.getAttribute("data-tag-path");
      if (path) {
        return { path };
      }
      return undefined;
    },
  }
);
