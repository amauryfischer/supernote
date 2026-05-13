// Mention inline content — @Name resolving to entity
// Displays a clickable pill with type icon and a route-aware href.

import { createInlineContentSpec } from "@blocknote/core";

const TYPE_ICONS: Record<string, string> = {
  personne: "👤",
  contact: "👤",
  organisation: "🏢",
  note: "📝",
  actif: "💰",
  tag: "#",
  vue: "👁",
  default: "@",
};

function getIcon(entityType: string): string {
  return TYPE_ICONS[entityType.toLowerCase()] ?? TYPE_ICONS["default"] ?? "@";
}

/**
 * Map an entity typeId to its detail-page route.
 * Falls back to /notes/{id} so the mention is always navigable.
 */
function hrefForEntity(id: string, entityType: string): string {
  if (!id) return "#";
  const t = entityType.toLowerCase();
  if (t === "personne" || t === "contact") return `/contacts/${id}`;
  if (t === "organisation") return `/contacts/${id}`;
  if (t === "actif") return `/finance/actifs/${id}`;
  if (t === "note") return `/notes/${id}`;
  return `/notes/${id}`;
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
      const pill = document.createElement("a");
      pill.className = "sn-mention";
      pill.setAttribute("data-mention-id", inlineContent.props.id);
      pill.setAttribute("data-mention-name", inlineContent.props.name);
      pill.setAttribute("data-mention-type", inlineContent.props.entityType);
      pill.setAttribute("contenteditable", "false");
      pill.setAttribute("tabindex", "0");
      pill.href = hrefForEntity(
        inlineContent.props.id,
        inlineContent.props.entityType
      );

      const icon = document.createElement("span");
      icon.className = "sn-mention__icon";
      icon.setAttribute("aria-hidden", "true");
      icon.textContent = getIcon(inlineContent.props.entityType);

      const label = document.createElement("span");
      label.className = "sn-mention__label";
      label.textContent = `@${inlineContent.props.name}`;

      pill.appendChild(icon);
      pill.appendChild(label);

      // Dispatch a custom event in addition to native navigation so hosts can
      // intercept (e.g. open in side panel) without preventDefault.
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
