// Mention inline content — @Name resolving to entity
// Displays a pill with type icon

import { createInlineContentSpec } from "@blocknote/core";

const TYPE_ICONS: Record<string, string> = {
  personne: "👤",
  organisation: "🏢",
  projet: "📋",
  default: "@",
};

function getIcon(entityType: string): string {
  return TYPE_ICONS[entityType.toLowerCase()] ?? TYPE_ICONS["default"] ?? "@";
}

export const mentionInlineSpec = createInlineContentSpec(
  {
    type: "mention" as const,
    content: "none" as const,
    propSchema: {
      id: { default: "" },
      name: { default: "" },
      entityType: { default: "" as string },
    },
  },
  {
    render(inlineContent, _update, _editor) {
      const pill = document.createElement("span");
      pill.className = "sn-mention";
      pill.setAttribute("data-mention-id", inlineContent.props.id);
      pill.setAttribute("data-mention-type", inlineContent.props.entityType);
      pill.setAttribute("contenteditable", "false");
      pill.setAttribute("role", "link");
      pill.setAttribute("tabindex", "0");

      const icon = document.createElement("span");
      icon.className = "sn-mention__icon";
      icon.setAttribute("aria-hidden", "true");
      icon.textContent = getIcon(inlineContent.props.entityType);

      const label = document.createElement("span");
      label.className = "sn-mention__label";
      label.textContent = `@${inlineContent.props.name}`;

      pill.appendChild(icon);
      pill.appendChild(label);

      pill.addEventListener("click", () => {
        const event = new CustomEvent("supernote:mention-click", {
          bubbles: true,
          detail: {
            id: inlineContent.props.id,
            name: inlineContent.props.name,
            type: inlineContent.props.entityType,
          },
        });
        pill.dispatchEvent(event);
      });

      return { dom: pill };
    },

    toExternalHTML(inlineContent, _editor) {
      const span = document.createElement("span");
      span.textContent = `@${inlineContent.props.name}`;
      return { dom: span };
    },

    parse(el) {
      const id = el.getAttribute("data-mention-id");
      if (id) {
        return {
          id,
          name: el.getAttribute("data-mention-name") ?? "",
          entityType: el.getAttribute("data-mention-type") ?? "",
        };
      }
      return undefined;
    },
  }
);
