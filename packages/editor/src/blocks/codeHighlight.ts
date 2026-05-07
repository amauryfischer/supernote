// Code block with shiki syntax highlighting (lazy loaded)
// Extends the built-in code block behavior with language selection + highlight

import { createBlockSpec } from "@blocknote/core";

const SUPPORTED_LANGUAGES = [
  "text",
  "javascript",
  "typescript",
  "python",
  "rust",
  "go",
  "java",
  "css",
  "html",
  "json",
  "yaml",
  "toml",
  "bash",
  "markdown",
  "sql",
] as const;

export type CodeLanguage = (typeof SUPPORTED_LANGUAGES)[number];

let shikiHighlighter: ((code: string, lang: string) => Promise<string>) | null = null;

async function highlight(code: string, lang: string): Promise<string> {
  if (!shikiHighlighter) {
    const { createHighlighter } = await import("shiki");
    const highlighter = await createHighlighter({
      themes: ["github-light"],
      langs: SUPPORTED_LANGUAGES.filter((l) => l !== "text"),
    });
    shikiHighlighter = (c, l) =>
      Promise.resolve(
        highlighter.codeToHtml(c, { lang: l as CodeLanguage, theme: "github-light" })
      );
  }
  return shikiHighlighter(code, lang);
}

export const codeHighlightBlockSpec = createBlockSpec(
  {
    type: "codeHighlight" as const,
    propSchema: {
      language: {
        default: "text" as CodeLanguage,
        values: [...SUPPORTED_LANGUAGES],
      },
      code: {
        default: "",
      },
    },
    content: "none" as const,
  },
  {
    render(block, _editor) {
      const wrapper = document.createElement("div");
      wrapper.className = "sn-code-block";

      const header = document.createElement("div");
      header.className = "sn-code-block__header";

      const langLabel = document.createElement("span");
      langLabel.className = "sn-code-block__lang";
      langLabel.textContent = block.props.language ?? "text";
      header.appendChild(langLabel);

      const pre = document.createElement("pre");
      pre.className = "sn-code-block__pre";
      const code = document.createElement("code");
      code.className = `language-${block.props.language ?? "text"}`;
      code.textContent = block.props.code ?? "";
      pre.appendChild(code);

      wrapper.appendChild(header);
      wrapper.appendChild(pre);

      // Lazy apply shiki highlight
      if (block.props.code && block.props.language !== "text") {
        highlight(block.props.code, block.props.language ?? "text").then((html) => {
          pre.innerHTML = html;
        });
      }

      return { dom: wrapper };
    },

    toExternalHTML(block, _editor, _ctx) {
      const pre = document.createElement("pre");
      const code = document.createElement("code");
      code.className = `language-${block.props.language ?? "text"}`;
      code.textContent = block.props.code ?? "";
      pre.appendChild(code);
      return { dom: pre };
    },
  }
);
