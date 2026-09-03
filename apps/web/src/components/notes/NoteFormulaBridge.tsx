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

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { ProgressBar } from "@heroui/react";
import { FormulaInputEditor } from "@/components/bases/FormulaInputEditor";
import { trpc } from "@/lib/trpc/client";
import type { EntityType } from "@supernote/core";

/** Modes d'affichage des blocs vivants (contrat partagé avec @supernote/editor). */
type FormulaDisplay = "value" | "countdown" | "progress" | "sparkline";

function asDisplay(v: string | undefined): FormulaDisplay {
  return v === "countdown" || v === "progress" || v === "sparkline" ? v : "value";
}

// ── Format helpers ───────────────────────────────────────────────────────────

export function formatJsonValue(raw: string | null, outputKind?: string): string {
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

// ── Widgets vivants ──────────────────────────────────────────────────────────

const WIDGET_ACCENT = "#6366F1";

function parseRaw(raw: string | null): unknown {
  if (raw === null) return null;
  try { return JSON.parse(raw); } catch { return raw; }
}

/** Résout la cible d'un countdown : Date ISO sérialisée ou DurationValue. */
function countdownTarget(v: unknown, evaluatedAt: number): Date | null {
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}([T\s]|$)/.test(v)) {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof v === "object" && v !== null) {
    const dur = v as { _type?: string; ms?: number };
    if (dur._type === "duration" && typeof dur.ms === "number") {
      return new Date(evaluatedAt + dur.ms);
    }
  }
  return null;
}

function splitDuration(ms: number): { d: number; h: number; m: number; s: number } {
  const total = Math.floor(ms / 1000);
  return {
    d: Math.floor(total / 86400),
    h: Math.floor((total % 86400) / 3600),
    m: Math.floor((total % 3600) / 60),
    s: total % 60,
  };
}

function CountdownWidget({ target }: { target: Date }): React.JSX.Element {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const diff = target.getTime() - now;
  const past = diff < 0;
  const { d, h, m, s } = splitDuration(Math.abs(diff));
  const pad = (n: number): string => String(n).padStart(2, "0");

  const seg = (value: string, unit: string): React.ReactNode => (
    <span key={unit} style={{ marginRight: 6 }}>
      <span style={{ fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>{value}</span>
      <span style={{ fontSize: "0.78em", color: "var(--text-muted)", marginLeft: 1 }}>{unit}</span>
    </span>
  );

  const segments: React.ReactNode[] = [];
  if (d > 0) segments.push(seg(String(d), "j"));
  if (d > 0 || h > 0) segments.push(seg(d > 0 ? pad(h) : String(h), "h"));
  segments.push(seg(pad(m), "min"));
  segments.push(seg(pad(s), "s"));

  return (
    <span style={{ color: past ? "var(--destructive)" : undefined, whiteSpace: "nowrap" }}>
      {past && <span style={{ marginRight: 6, fontSize: "0.85em" }}>échu depuis</span>}
      {segments}
    </span>
  );
}

function ProgressWidget({ value }: { value: number }): React.JSX.Element {
  // ≤ 1 → ratio ; > 1 → pourcentage déjà exprimé sur 100.
  const ratio = value <= 1 ? value : value / 100;
  const pct = Math.round(Math.min(1, Math.max(0, ratio)) * 100);
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        verticalAlign: "middle",
        minWidth: 150,
        maxWidth: 280,
        width: "100%",
      }}
    >
      <span style={{ flex: 1, minWidth: 100 }}>
        <ProgressBar value={pct} minValue={0} maxValue={100} aria-label="Progression">
          <ProgressBar.Track>
            <ProgressBar.Fill />
          </ProgressBar.Track>
        </ProgressBar>
      </span>
      <span
        style={{
          fontVariantNumeric: "tabular-nums",
          fontSize: "0.85em",
          fontWeight: 600,
          color: "var(--text-secondary)",
        }}
      >
        {pct}%
      </span>
    </span>
  );
}

/**
 * Tracé en SVG nu plutôt qu'avec recharts : la lib entrait dans le graphe
 * statique de l'entrée par ce seul import (~120 Ko gzip préchargés au boot)
 * pour dessiner une polyline de 120×28.
 */
function sparklinePath(values: number[], w: number, h: number, pad: number): { line: string; area: string } {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const stepX = values.length > 1 ? (w - pad * 2) / (values.length - 1) : 0;
  const points = values.map((v, i) => {
    const x = pad + i * stepX;
    const y = pad + (h - pad * 2) * (1 - (v - min) / span);
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  });
  const line = `M${points.join("L")}`;
  const first = points[0]?.split(",")[0] ?? "0";
  const lastX = points[points.length - 1]?.split(",")[0] ?? "0";
  return { line, area: `${line}L${lastX},${h - pad}L${first},${h - pad}Z` };
}

function SparklineWidget({ values, inline }: { values: number[]; inline?: boolean }): React.JSX.Element {
  const w = inline ? 120 : 240;
  const h = inline ? 28 : 56;
  const { line, area } = useMemo(() => sparklinePath(values, w, h, 2), [values, w, h]);
  const last = values[values.length - 1];
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8, verticalAlign: "middle" }}>
      <span style={{ display: "inline-block", lineHeight: 0 }}>
        <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="presentation" aria-hidden="true">
          <path d={area} fill={WIDGET_ACCENT} fillOpacity={0.15} />
          <path
            d={line}
            fill="none"
            stroke={WIDGET_ACCENT}
            strokeWidth={1.5}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
      {last !== undefined && (
        <span
          style={{
            fontVariantNumeric: "tabular-nums",
            fontSize: "0.85em",
            fontWeight: 600,
            color: "var(--text-secondary)",
          }}
        >
          {last.toLocaleString()}
        </span>
      )}
    </span>
  );
}

/** Hint discret quand la formule ne retourne pas le type attendu par le widget. */
function WidgetHint({ text, onEdit }: { text: string; onEdit?: () => void }): React.JSX.Element {
  return (
    <span onClick={onEdit} style={{ color: "var(--text-muted)", cursor: "pointer" }}>
      {text}
    </span>
  );
}

// ── Renderer pour FormulaProvider ────────────────────────────────────────────

function FormulaResult({
  expression, outputKind, display, inline, onEdit,
}: {
  expression: string;
  outputKind?: string;
  display?: string;
  inline?: boolean;
  onEdit?: () => void;
}): React.JSX.Element {
  const enabled = !!expression.trim();
  const mode = asDisplay(display);
  const isWidget = mode !== "value";
  const isCountdown = mode === "countdown";
  // Widgets : refetch périodique pour rester vivants (countdown ne re-évalue
  // que pour corriger la cible, le tick est local).
  const { data, isLoading, dataUpdatedAt } = trpc.formulas.evaluate.useQuery(
    { expression },
    {
      enabled,
      staleTime: isWidget ? (isCountdown ? 60_000 : 5_000) : 30_000,
      refetchInterval: isWidget ? (isCountdown ? 60_000 : 15_000) : undefined,
    },
  );
  const value = useMemo(
    () => (data && !data.error ? parseRaw(data.value) : null),
    [data],
  );
  const target = useMemo(
    () => (isCountdown ? countdownTarget(value, dataUpdatedAt || Date.now()) : null),
    [isCountdown, value, dataUpdatedAt],
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

  if (mode === "countdown") {
    if (!target) return <WidgetHint text="⏳ la formule doit retourner une date" onEdit={onEdit} />;
    return <CountdownWidget target={target} />;
  }
  if (mode === "progress") {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return <WidgetHint text="▰ la formule doit retourner un nombre (0–1 ou 0–100)" onEdit={onEdit} />;
    }
    return <ProgressWidget value={value} />;
  }
  if (mode === "sparkline") {
    const nums = Array.isArray(value)
      ? value.filter((x): x is number => typeof x === "number" && Number.isFinite(x))
      : [];
    if (nums.length < 2) {
      return <WidgetHint text="📈 la formule doit retourner une liste de nombres" onEdit={onEdit} />;
    }
    return <SparklineWidget values={nums} inline={inline} />;
  }

  return <span>{formatJsonValue(data.value, outputKind)}</span>;
}

export function renderNoteFormula(props: {
  expression: string;
  outputKind?: string;
  display?: string;
  inline?: boolean;
  onEdit?: () => void;
}): React.ReactNode {
  return (
    <FormulaResult
      expression={props.expression}
      outputKind={props.outputKind}
      display={props.display}
      inline={props.inline}
      onEdit={props.onEdit}
    />
  );
}

// ── Modal host ───────────────────────────────────────────────────────────────

type EditState =
  | null
  | { kind: "block"; blockId: string; expression: string; outputKind: string; display: FormulaDisplay; onUpdate: (next: { expression: string; outputKind: string; display: string }) => void }
  | { kind: "inline"; expression: string; outputKind: string; display: FormulaDisplay };

export function NoteFormulaModalHost({ stubBase }: { stubBase: EntityType }) {
  const [edit, setEdit] = useState<EditState>(null);

  useEffect(() => {
    const onBlock = (e: Event) => {
      const ce = e as CustomEvent<{
        blockId: string;
        expression: string;
        outputKind: string;
        display?: string;
        onUpdate?: (next: { expression: string; outputKind: string; display: string }) => void;
      }>;
      const detail = ce.detail;
      if (!detail) return;
      setEdit({
        kind: "block",
        blockId: detail.blockId,
        expression: detail.expression ?? "",
        outputKind: detail.outputKind ?? "text",
        display: asDisplay(detail.display),
        onUpdate: detail.onUpdate ?? (() => undefined),
      });
    };
    const onInline = (e: Event) => {
      const ce = e as CustomEvent<{ expression: string; outputKind: string; display?: string }>;
      const detail = ce.detail;
      if (!detail) return;
      setEdit({
        kind: "inline",
        expression: detail.expression ?? "",
        outputKind: detail.outputKind ?? "text",
        display: asDisplay(detail.display),
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
          initialDisplay={edit.display}
          showDisplaySelector
          onSubmit={(expression, outputKind, display) => {
            const nextDisplay = asDisplay(display ?? edit.display);
            if (edit.kind === "block") {
              edit.onUpdate({ expression, outputKind, display: nextDisplay });
            } else {
              // Inline replacement: dispatch via event listener captured by SupernoteEditor host.
              window.dispatchEvent(new CustomEvent("supernote:formula-inline-commit", {
                detail: { expression, outputKind, display: nextDisplay },
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
