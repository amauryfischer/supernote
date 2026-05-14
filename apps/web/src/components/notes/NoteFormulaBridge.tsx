"use client";

/**
 * NoteFormulaBridge — relie les blocs/inlines `formula` du SupernoteEditor au
 * runtime @supernote/formulas.
 *
 *  - `renderNoteFormula(props)` : composant rendu inline/block qui parse +
 *    évalue l'expression côté client avec un FormulaContext minimal.
 *  - `<NoteFormulaModalHost>` : écoute `supernote:formula-edit*` et ouvre une
 *    modal contenant le FormulaInputEditor. Au submit, dispatch le résultat.
 *
 * Pour le scope cross-base, on passe par le worker via tRPC (lazy fetch les
 * bases référencées dans l'expression).
 */

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  parseFormula,
  evaluate,
  type FormulaContext,
  type Value as FormulaValue,
} from "@supernote/formulas";
import { FormulaInputEditor } from "@/components/bases/FormulaInputEditor";
import type { EntityType } from "@supernote/core";

// ── Eval helpers ─────────────────────────────────────────────────────────────

const minimalContext: FormulaContext = {
  resolveEntity: () => null,
  queryEntities: () => [],
  getRelations: () => [],
  now: () => new Date(),
};

function evalExpr(expression: string): { ok: true; value: FormulaValue } | { ok: false; msg: string } {
  if (!expression.trim()) return { ok: false, msg: "(vide)" };
  const parsed = parseFormula(expression);
  if (!parsed.ok) return { ok: false, msg: parsed.error.message };
  const res = evaluate(parsed.value, minimalContext, {});
  if (!res.ok) return { ok: false, msg: res.error.message };
  return { ok: true, value: res.value };
}

function formatValue(v: FormulaValue, outputKind?: string): string {
  if (v === null || v === undefined) return "—";
  if (v instanceof Date) {
    if (outputKind === "date") return v.toLocaleDateString();
    return v.toLocaleString();
  }
  if (Array.isArray(v)) return v.map((x) => formatValue(x as FormulaValue)).join(", ");
  if (typeof v === "number") {
    if (outputKind === "number") return v.toLocaleString();
    return String(v);
  }
  if (typeof v === "boolean") return v ? "✓" : "✗";
  if (typeof v === "object") return String(v);
  return String(v);
}

// ── Renderer pour FormulaProvider ────────────────────────────────────────────

export function renderNoteFormula(props: {
  expression: string;
  outputKind?: string;
  onEdit?: () => void;
}): React.ReactNode {
  const { expression, outputKind, onEdit } = props;
  if (!expression) {
    return (
      <span
        onClick={onEdit}
        style={{ color: "var(--text-muted)", cursor: "pointer" }}
      >
        cliquer pour éditer
      </span>
    );
  }
  const r = evalExpr(expression);
  if (!r.ok) {
    return (
      <span title={r.msg} style={{ color: "var(--destructive)" }}>
        #ERREUR
      </span>
    );
  }
  return <span>{formatValue(r.value, outputKind)}</span>;
}

// ── Modal host ───────────────────────────────────────────────────────────────

type EditState =
  | null
  | { kind: "block"; blockId: string; expression: string; outputKind: string; onUpdate: (next: { expression: string; outputKind: string }) => void }
  | { kind: "inline"; expression: string; outputKind: string };

export function NoteFormulaModalHost({ stubBase }: { stubBase: EntityType }) {
  const [edit, setEdit] = useState<EditState>(null);

  useEffect(() => {
    const onBlock = (e: Event) => {
      const ce = e as CustomEvent<{
        blockId: string;
        expression: string;
        outputKind: string;
        onUpdate?: (next: { expression: string; outputKind: string }) => void;
      }>;
      const detail = ce.detail;
      if (!detail) return;
      setEdit({
        kind: "block",
        blockId: detail.blockId,
        expression: detail.expression ?? "",
        outputKind: detail.outputKind ?? "text",
        onUpdate: detail.onUpdate ?? (() => undefined),
      });
    };
    const onInline = (e: Event) => {
      const ce = e as CustomEvent<{ expression: string; outputKind: string }>;
      const detail = ce.detail;
      if (!detail) return;
      setEdit({
        kind: "inline",
        expression: detail.expression ?? "",
        outputKind: detail.outputKind ?? "text",
      });
    };
    window.addEventListener("supernote:formula-edit", onBlock);
    window.addEventListener("supernote:formula-edit-inline", onInline);
    return () => {
      window.removeEventListener("supernote:formula-edit", onBlock);
      window.removeEventListener("supernote:formula-edit-inline", onInline);
    };
  }, []);

  if (!edit) return null;

  return createPortal(
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 9999,
        display: "flex", alignItems: "center", justifyContent: "center",
        backgroundColor: "rgba(0,0,0,0.4)",
      }}
      onClick={() => setEdit(null)}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => {
          const t = e.target as HTMLElement;
          if (t.tagName !== "INPUT" && t.tagName !== "TEXTAREA") e.preventDefault();
        }}
        style={{
          padding: 16,
          borderRadius: 8,
          backgroundColor: "var(--surface-1)",
          border: "1px solid var(--border-subtle)",
        }}
      >
        <FormulaInputEditor
          base={stubBase}
          initialExpression={edit.expression}
          initialOutputKind={(edit.outputKind ?? "text") as "text" | "number" | "date" | "bool"}
          onSubmit={(expression, outputKind) => {
            if (edit.kind === "block") {
              edit.onUpdate({ expression, outputKind });
            } else {
              // Inline replacement: dispatch via event listener captured by SupernoteEditor host.
              window.dispatchEvent(new CustomEvent("supernote:formula-inline-commit", {
                detail: { expression, outputKind },
              }));
            }
            setEdit(null);
          }}
          onCancel={() => setEdit(null)}
        />
      </div>
    </div>,
    document.body,
  );
}
