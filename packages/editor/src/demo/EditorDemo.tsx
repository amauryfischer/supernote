// Interactive demo component for the Supernote editor

import React, { useState } from "react";
import { SupernoteEditor } from "../SupernoteEditor.js";
import type { Block } from "@blocknote/core";

const DEMO_MARKDOWN = `# Supernote Editor Demo

This is the **Supernote** rich-text editor powered by BlockNote.

## Custom Blocks

### Callout

> [!INFO] Welcome
> This is an info callout with _styled_ content.

### Code Block

\`\`\`typescript
function greet(name: string): string {
  return \`Hello, \${name}!\`;
}
\`\`\`

### Wikilink & Mentions

Link to [[Jean Dupont|Jean]] and embed a note: ![[Daily/2026-05-07]]

Tag this note: #projet/supernote

Mention someone: @Marie Curie

## Standard Blocks

- Bullet item one
- Bullet item two
  - Nested item

1. Numbered item
2. Another item

- [ ] Todo item unchecked
- [x] Todo item checked

---

Regular paragraph with **bold**, _italic_, and \`inline code\`.
`;

/** Interactive demo for the Supernote editor. Mount this in a dev page. */
export function EditorDemo(): React.JSX.Element {
  const [markdown, setMarkdown] = useState(DEMO_MARKDOWN);
  const [showMarkdown, setShowMarkdown] = useState(false);

  function handleChange(md: string, _blocks: Block[]) {
    setMarkdown(md);
  }

  function handleSave(md: string) {
    console.info("[EditorDemo] Saved:", md.slice(0, 100));
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh" }}>
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0.5rem 1rem",
          borderBottom: "1px solid #e5e7eb",
          background: "#f5f3ff",
        }}
      >
        <strong style={{ color: "#7c3aed" }}>Supernote Editor Demo</strong>
        <button
          onClick={() => setShowMarkdown((v) => !v)}
          style={{
            padding: "0.3rem 0.8rem",
            background: "#7c3aed",
            color: "#fff",
            border: "none",
            borderRadius: "4px",
            cursor: "pointer",
            fontSize: "0.85rem",
          }}
        >
          {showMarkdown ? "Hide" : "Show"} Markdown
        </button>
      </header>

      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        <div style={{ flex: 1, overflow: "auto", padding: "1.5rem 2rem" }}>
          <SupernoteEditor
            initialMarkdown={DEMO_MARKDOWN}
            onChange={handleChange}
            onSave={handleSave}
            placeholder="Start writing…"
          />
        </div>

        {showMarkdown && (
          <aside
            style={{
              width: "40%",
              borderLeft: "1px solid #e5e7eb",
              overflow: "auto",
              padding: "1rem",
            }}
          >
            <pre
              style={{
                fontFamily: "ui-monospace, monospace",
                fontSize: "0.8rem",
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                color: "#374151",
              }}
            >
              {markdown}
            </pre>
          </aside>
        )}
      </div>
    </div>
  );
}
