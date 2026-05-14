// Formula block + inline formula — exécute une expression @supernote/formulas
// inline dans la note. Le rendu est délégué à l'app hôte via un provider context
// (comme databaseView). Le bloc/inline stocke uniquement l'expression source
// + un cache de la dernière valeur évaluée (string serialisée).

import * as React from "react";
import { createReactBlockSpec, createReactInlineContentSpec } from "@blocknote/react";

// ── Renderer slot ────────────────────────────────────────────────────────────

export interface FormulaRenderProps {
  expression: string;
  /** Hint éventuel sur le type attendu (text/number/date/bool). */
  outputKind?: string;
  /** Édition demandée — l'host doit ouvrir son éditeur de formule. */
  onEdit?: () => void;
}

export type FormulaRenderer = (props: FormulaRenderProps) => React.ReactNode;

const FormulaRendererContext = React.createContext<FormulaRenderer | null>(null);

export function FormulaProvider({
  renderer, children,
}: { renderer: FormulaRenderer; children: React.ReactNode }): React.JSX.Element {
  return (
    <FormulaRendererContext.Provider value={renderer}>
      {children}
    </FormulaRendererContext.Provider>
  );
}

export function useFormulaRenderer(): FormulaRenderer | null {
  return React.useContext(FormulaRendererContext);
}

// ── Block ────────────────────────────────────────────────────────────────────

export const formulaBlockSpec = createReactBlockSpec(
  {
    type: "formula" as const,
    propSchema: {
      expression: { default: "" },
      outputKind: { default: "text" },
    },
    content: "none" as const,
  },
  {
    render: ({ block, editor }) => {
      const renderer = useFormulaRenderer();
      const expression = (block.props.expression ?? "") as string;
      const outputKind = (block.props.outputKind ?? "text") as string;
      const handleEdit = () => {
        const event = new CustomEvent("supernote:formula-edit", {
          bubbles: true,
          detail: {
            blockId: block.id,
            expression,
            outputKind,
            onUpdate: (next: { expression: string; outputKind: string }) => {
              editor.updateBlock(block.id, {
                props: { expression: next.expression, outputKind: next.outputKind },
              } as never);
            },
          },
        });
        window.dispatchEvent(event);
      };
      return (
        <div
          className="sn-formula-block"
          contentEditable={false}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "6px 10px",
            borderRadius: 6,
            border: "1px solid var(--border-subtle)",
            backgroundColor: "var(--surface-1)",
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            fontSize: 12,
          }}
        >
          <span aria-hidden="true" style={{ color: "var(--accent)", fontWeight: 700 }}>ƒ</span>
          {renderer ? renderer({ expression, outputKind, onEdit: handleEdit }) : (
            <code style={{ color: "var(--text-secondary)" }}>{expression || "(formule vide)"}</code>
          )}
          <button
            type="button"
            onClick={handleEdit}
            style={{
              marginLeft: "auto",
              fontSize: 10,
              color: "var(--text-muted)",
              background: "transparent",
              cursor: "pointer",
            }}
          >
            ✎ éditer
          </button>
        </div>
      );
    },
    toExternalHTML: ({ block }) => {
      const expression = (block.props.expression ?? "") as string;
      const outputKind = (block.props.outputKind ?? "text") as string;
      return (
        <div
          className="sn-formula-block-export"
          data-formula={expression}
          data-output-kind={outputKind}
        >
          <code>{`{= ${expression}}`}</code>
        </div>
      );
    },
  }
);

// ── Inline content ──────────────────────────────────────────────────────────

export const formulaInlineSpec = createReactInlineContentSpec(
  {
    type: "formulaInline" as const,
    content: "none" as const,
    propSchema: {
      expression: { default: "" },
      outputKind: { default: "text" },
    },
  },
  {
    render: ({ inlineContent }) => {
      const renderer = useFormulaRenderer();
      const expression = (inlineContent.props.expression ?? "") as string;
      const outputKind = (inlineContent.props.outputKind ?? "text") as string;
      const handleEdit = () => {
        const event = new CustomEvent("supernote:formula-edit-inline", {
          bubbles: true,
          detail: {
            expression,
            outputKind,
            onUpdate: (_next: { expression: string; outputKind: string }) => {
              // BlockNote inline content update requires a different API; we
              // dispatch the value back via the event listener which handles
              // replacement via editor.insertInlineContent + delete previous.
            },
          },
        });
        window.dispatchEvent(event);
      };
      return (
        <span
          className="sn-formula-inline"
          contentEditable={false}
          role="button"
          tabIndex={0}
          onClick={handleEdit}
          onKeyDown={(e) => { if (e.key === "Enter") handleEdit(); }}
          title={`= ${expression || "(vide)"}`}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 3,
            padding: "0 4px",
            borderRadius: 3,
            backgroundColor: "rgba(139,92,246,0.12)",
            color: "#7C3AED",
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            fontSize: "0.9em",
            cursor: "pointer",
            userSelect: "none",
          }}
        >
          <span aria-hidden="true" style={{ fontWeight: 600 }}>ƒ</span>
          {renderer
            ? renderer({ expression, outputKind })
            : <span style={{ color: "var(--text-muted)" }}>{expression || "..."}</span>}
        </span>
      );
    },
  }
);
