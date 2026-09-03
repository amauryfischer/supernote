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

type Highlighter = (code: string, lang: string) => string;

let shikiHighlighter: Highlighter | null = null;
let loading: Promise<Highlighter> | null = null;

/**
 * `createHighlighter` du bundle `shiki` référence le registre complet des
 * ~200 grammaires : Rollup en émettait un chunk chacune (~450 fichiers, 25 Mo
 * d'assets) plus le WASM Oniguruma (600 Ko). Le core avec les grammaires
 * listées ici et le moteur regex JS ne charge que ce qu'on propose vraiment.
 */
async function loadHighlighter(): Promise<Highlighter> {
  const [
    { createHighlighterCore },
    { createJavaScriptRegexEngine },
    githubLight,
    ...langs
  ] = await Promise.all([
    import("shiki/core"),
    import("shiki/engine/javascript"),
    import("@shikijs/themes/github-light"),
    import("@shikijs/langs/javascript"),
    import("@shikijs/langs/typescript"),
    import("@shikijs/langs/python"),
    import("@shikijs/langs/rust"),
    import("@shikijs/langs/go"),
    import("@shikijs/langs/java"),
    import("@shikijs/langs/css"),
    import("@shikijs/langs/html"),
    import("@shikijs/langs/json"),
    import("@shikijs/langs/yaml"),
    import("@shikijs/langs/toml"),
    import("@shikijs/langs/bash"),
    import("@shikijs/langs/markdown"),
    import("@shikijs/langs/sql"),
  ]);

  const core = await createHighlighterCore({
    themes: [githubLight],
    langs,
    // forgiving : une grammaire dont une regex Oniguruma n'a pas d'équivalent
    // JS dégrade en texte brut au lieu de faire échouer tout le bloc.
    engine: createJavaScriptRegexEngine({ forgiving: true }),
  });

  return (c, l) => core.codeToHtml(c, { lang: l, theme: "github-light" });
}

async function highlight(code: string, lang: string): Promise<string> {
  if (!shikiHighlighter) {
    loading ??= loadHighlighter();
    shikiHighlighter = await loading;
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
