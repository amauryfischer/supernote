// Tag inline content — #tag or #path/sous-tag
// Renders as a colored pill

import { createInlineContentSpec } from "@blocknote/core";

const TAG_KINDS: Record<string, string> = {
  TODO: "todo", AFAIRE: "todo",
  FIXME: "bug", BUG: "bug",
  URGENT: "urgent",
  IDEE: "idea", IDEA: "idea", NOTE: "idea",
  QUESTION: "question",
  DONE: "done", FAIT: "done",
};

// Même table que NoteMinimap (web) : le paquet n'exporte pas ce helper.
function tagKind(path: string): string | undefined {
  const head = path.split("/")[0] ?? "";
  const key = head.normalize("NFD").replace(/\p{M}/gu, "").replace(/[-_\s]/g, "").toUpperCase();
  return TAG_KINDS[key];
}

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
      const kind = tagKind(inlineContent.props.path);
      if (kind) pill.setAttribute("data-tag-kind", kind);
      pill.setAttribute("contenteditable", "false");
      pill.setAttribute("role", "link");
      pill.textContent = `#${inlineContent.props.path}`;

      // Pastille non sélectionnable : sans ça, un clic dessus laissait le curseur où il était et Effacer ne l'atteignait pas.
      pill.addEventListener("mousedown", (e) => {
        if (e.button !== 0 || !pill.parentNode) return;
        e.preventDefault();
        (pill.closest(".ProseMirror") as HTMLElement | null)?.focus({ preventScroll: true });
        const box = pill.getBoundingClientRect();
        const index = Array.prototype.indexOf.call(pill.parentNode.childNodes, pill) as number;
        window.getSelection()?.collapse(pill.parentNode, e.clientX > box.left + box.width / 2 ? index + 1 : index);
      });

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
