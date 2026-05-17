// Formula block + inline formula — exécute une expression @supernote/formulas
// inline dans la note. Le rendu est délégué à l'app hôte via un provider context
// (comme databaseView). Le bloc/inline stocke uniquement l'expression source
// + un cache de la dernière valeur évaluée (string serialisée).

import * as React from "react";
import { createPortal } from "react-dom";
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

// ── Context menu (clic droit) ────────────────────────────────────────────────

interface FormulaMenuItem {
  label: string;
  onClick: () => void;
}

function FormulaContextMenu({
  x, y, items, onClose,
}: { x: number; y: number; items: FormulaMenuItem[]; onClose: () => void }): React.JSX.Element {
  React.useEffect(() => {
    const close = () => onClose();
    window.addEventListener("mousedown", close);
    window.addEventListener("scroll", close, true);
    window.addEventListener("contextmenu", close);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("contextmenu", close);
    };
  }, [onClose]);

  return createPortal(
    <div
      role="menu"
      onMouseDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
      style={{
        position: "fixed",
        top: y,
        left: x,
        zIndex: 99999,
        minWidth: 180,
        padding: 4,
        borderRadius: 6,
        backgroundColor: "var(--surface-1, #fff)",
        border: "1px solid var(--border-subtle, #ddd)",
        boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
        fontSize: 13,
      }}
    >
      {items.map((it, i) => (
        <button
          key={i}
          type="button"
          onClick={() => { it.onClick(); onClose(); }}
          style={{
            display: "block",
            width: "100%",
            textAlign: "left",
            padding: "6px 10px",
            background: "transparent",
            border: "none",
            cursor: "pointer",
            color: "var(--text-primary, #000)",
            borderRadius: 4,
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = "var(--surface-2, #f3f3f3)")}
          onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
        >
          {it.label}
        </button>
      ))}
    </div>,
    document.body,
  );
}

interface FormulaContentProps {
  expression: string;
  outputKind: string;
  inline: boolean;
  onEdit: () => void;
}

function FormulaContent({ expression, outputKind, inline, onEdit }: FormulaContentProps): React.JSX.Element {
  const renderer = useFormulaRenderer();
  const [menu, setMenu] = React.useState<{ x: number; y: number } | null>(null);
  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ x: e.clientX, y: e.clientY });
  };
  const copyResult = async () => {
    // Le renderer affiche le résultat formaté ; à défaut, on copie l'expression.
    try {
      const sel = window.getSelection();
      const text = sel?.toString() || expression;
      await navigator.clipboard.writeText(text);
    } catch {
      /* ignore */
    }
  };
  const copyExpression = async () => {
    try { await navigator.clipboard.writeText(expression); } catch { /* ignore */ }
  };

  const Tag = inline ? "span" : "span";
  const fallback = (
    <span style={{ color: "var(--text-muted)" }}>
      {expression || (inline ? "ƒ" : "(formule vide)")}
    </span>
  );

  return (
    <>
      <Tag
        contentEditable={false}
        onContextMenu={handleContextMenu}
        title="Clic droit pour éditer"
        style={{
          cursor: "context-menu",
          textDecoration: expression ? "underline dotted var(--text-muted)" : undefined,
          textUnderlineOffset: 2,
        }}
      >
        {renderer
          ? renderer({ expression, outputKind, onEdit })
          : fallback}
      </Tag>
      {menu && (
        <FormulaContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={[
            { label: "Éditer la formule…", onClick: onEdit },
            { label: "Copier le résultat", onClick: copyResult },
            { label: "Copier l'expression", onClick: copyExpression },
          ]}
        />
      )}
    </>
  );
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
        <FormulaContent
          expression={expression}
          outputKind={outputKind}
          inline={false}
          onEdit={handleEdit}
        />
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
      const expression = (inlineContent.props.expression ?? "") as string;
      const outputKind = (inlineContent.props.outputKind ?? "text") as string;
      const handleEdit = () => {
        const event = new CustomEvent("supernote:formula-edit-inline", {
          bubbles: true,
          detail: { expression, outputKind },
        });
        window.dispatchEvent(event);
      };
      return (
        <FormulaContent
          expression={expression}
          outputKind={outputKind}
          inline
          onEdit={handleEdit}
        />
      );
    },
  }
);
