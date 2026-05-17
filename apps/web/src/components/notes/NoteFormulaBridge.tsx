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
import { FormulaInputEditor } from "@/components/bases/FormulaInputEditor";
import { trpc } from "@/lib/trpc/client";
import type { EntityType } from "@supernote/core";

// ── Format helpers ───────────────────────────────────────────────────────────

function formatJsonValue(raw: string | null, outputKind?: string): string {
  if (raw === null) return "—";
  let v: unknown;
  try { v = JSON.parse(raw); } catch { return raw; }
  return formatValue(v, outputKind);
}

function formatValue(v: unknown, outputKind?: string): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "string") {
    // Une chaîne ISO de date est sérialisée telle quelle ; on n'essaie pas de
    // la re-parse côté client pour rester déterministe.
    return v;
  }
  if (typeof v === "number") {
    return outputKind === "number" ? v.toLocaleString() : String(v);
  }
  if (typeof v === "boolean") return v ? "✓" : "✗";
  if (Array.isArray(v)) return v.map((x) => formatValue(x)).join(", ");
  if (typeof v === "object" && v !== null) {
    // Cas entity ({_type:"entity", entity:{fields:{name?:...}}}) → name si dispo
    const obj = v as { _type?: string; entity?: { fields?: Record<string, unknown> } };
    if (obj._type === "entity" && obj.entity?.fields) {
      const name = obj.entity.fields["name"];
      if (typeof name === "string") return name;
    }
    return String(v);
  }
  return String(v);
}

// ── Renderer pour FormulaProvider ────────────────────────────────────────────

function FormulaResult({
  expression, outputKind, onEdit,
}: { expression: string; outputKind?: string; onEdit?: () => void }): React.JSX.Element {
  const enabled = !!expression.trim();
  const { data, isLoading } = trpc.formulas.evaluate.useQuery(
    { expression },
    { enabled, staleTime: 1000 * 30 },
  );
  if (!enabled) {
    return (
      <span
        onClick={onEdit}
        style={{ color: "var(--text-muted)", cursor: "pointer" }}
      >
        cliquer pour éditer
      </span>
    );
  }
  if (isLoading || !data) return <span style={{ color: "var(--text-muted)" }}>…</span>;
  if (data.error) {
    return (
      <span title={data.error} style={{ color: "var(--destructive)" }}>
        #ERREUR
      </span>
    );
  }
  return <span>{formatJsonValue(data.value, outputKind)}</span>;
}

export function renderNoteFormula(props: {
  expression: string;
  outputKind?: string;
  onEdit?: () => void;
}): React.ReactNode {
  return (
    <FormulaResult
      expression={props.expression}
      outputKind={props.outputKind}
      onEdit={props.onEdit}
    />
  );
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
