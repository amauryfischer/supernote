"use client";

/**
 * Cell — one editable cell in a DataGrid, polymorphic on Field.kind.
 *
 * Display vs edit modes:
 *   - Display: a span/div showing the formatted value. Click to enter edit.
 *   - Edit: a kind-specific input. Enter / blur commits, Escape cancels.
 *
 * Read-only kinds (createdAt, updatedAt, autoNumber, formula, rollup, lookup,
 * file, image, relation) render in display mode only — they can't be edited
 * from the grid in Phase 1.
 */

import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Field, FieldValue, RelationField, SelectOption } from "@supernote/core";
import { trpc } from "@/lib/trpc/client";
import { RelationPicker } from "./RelationPicker";

export type AdvanceDir = "tab" | "shift-tab" | "enter" | "shift-enter";

interface CellProps {
  field: Field;
  value: unknown;
  onChange: (next: unknown, advance?: AdvanceDir) => void;
  readOnly?: boolean;
  /** Nonce qui, lorsqu'il change, force le passage en mode édition. */
  forceEditKey?: number;
  /**
   * Valeurs de la ligne entière + définitions des champs voisins. Nécessaires
   * pour les colonnes "ai" qui interpolent `{fieldName}` dans leur prompt.
   * Optionnel : si absent, le bouton "Regénérer" est désactivé.
   */
  rowFields?: Record<string, unknown>;
  baseFields?: Field[];
}

const READONLY_KINDS = new Set<Field["kind"]>([
  "createdAt",
  "updatedAt",
  "createdBy",
  "autoNumber",
  "formula",
  "rollup",
  "lookup",
  "ai",
]);

function CellInner({ field, value, onChange, readOnly, forceEditKey, rowFields, baseFields }: CellProps) {
  const [editing, setEditing] = useState(false);
  // initialChar : si on a démarré l'édition en tapant un caractère imprimable
  // depuis le mode display, on l'utilise comme draft initial (UX type tableur).
  const [initialChar, setInitialChar] = useState<string | undefined>(undefined);
  // Valeur "pending" : maintenue localement entre le commit et le moment où la
  // prop `value` rattrape (après invalidate+refetch de queryForView). Sans ça,
  // au blur le cell repasse en display mode avec l'ANCIENNE valeur de cache,
  // puis flash sur la nouvelle quand le refetch arrive.
  const [pending, setPending] = useState<{ value: unknown } | null>(null);
  const isReadOnly = readOnly || READONLY_KINDS.has(field.kind);

  // forceEditKey change → ouvre le mode édition. Le parent (DataGrid)
  // incrémente le nonce pour réclamer l'auto-edit après Tab/Enter ou
  // après création de ligne.
  const lastForceRef = useRef<number | undefined>(forceEditKey);
  useEffect(() => {
    if (
      forceEditKey !== undefined &&
      forceEditKey !== lastForceRef.current &&
      !isReadOnly
    ) {
      lastForceRef.current = forceEditKey;
      setInitialChar(undefined);
      setEditing(true);
    } else {
      lastForceRef.current = forceEditKey;
    }
  }, [forceEditKey, isReadOnly]);

  // Efface le pending dès que la prop value reflète la valeur committée.
  useEffect(() => {
    if (pending && cellValueEq(value, pending.value)) setPending(null);
  }, [value, pending]);

  const effectiveValue = pending ? pending.value : value;

  if (editing && !isReadOnly) {
    return (
      <CellEditor
        field={field}
        value={effectiveValue}
        initialChar={initialChar}
        onCommit={(next, advance) => {
          setEditing(false);
          setInitialChar(undefined);
          if (!cellValueEq(next, effectiveValue)) {
            setPending({ value: next });
            onChange(next, advance);
          } else if (advance) {
            // Pas de mutation mais on signale l'advance pour la navigation.
            onChange(effectiveValue, advance);
          }
        }}
        onCancel={() => {
          setEditing(false);
          setInitialChar(undefined);
        }}
      />
    );
  }

  return (
    <div
      className={`group flex h-full w-full items-center px-3 text-[13.5px] outline-none focus:[box-shadow:inset_0_0_0_2px_var(--accent)] motion-safe:[transition:box-shadow_var(--sn-dur-1)_var(--sn-ease-standard)] ${
        isReadOnly ? "" : "cursor-text"
      }`}
      data-cell-display=""
      onClick={() => {
        if (!isReadOnly) setEditing(true);
      }}
      onKeyDown={(e) => {
        if (isReadOnly) return;
        if (e.key === "Enter" || e.key === "F2") {
          e.preventDefault();
          setInitialChar(undefined);
          setEditing(true);
          return;
        }
        if (e.key === "Backspace" || e.key === "Delete") {
          e.preventDefault();
          onChange("" as unknown);
          return;
        }
        // Caractère imprimable seul → entre en édition + remplace la valeur.
        if (
          e.key.length === 1 &&
          !e.ctrlKey &&
          !e.metaKey &&
          !e.altKey
        ) {
          e.preventDefault();
          setInitialChar(e.key);
          setEditing(true);
        }
      }}
      tabIndex={isReadOnly ? -1 : 0}
      style={{ color: "var(--text-primary)" }}
    >
      {field.kind === "ai" ? (
        <AICellDisplay
          field={field}
          value={effectiveValue}
          rowFields={rowFields}
          baseFields={baseFields}
          onChange={onChange}
        />
      ) : (
        <CellDisplay field={field} value={effectiveValue} />
      )}
    </div>
  );
}

// ── AI cell ──────────────────────────────────────────────────────────────────

function AICellDisplay({
  field,
  value,
  rowFields,
  baseFields,
  onChange,
}: {
  field: Field;
  value: unknown;
  rowFields?: Record<string, unknown>;
  baseFields?: Field[];
  onChange: (next: unknown) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const run = async () => {
    if (busy) return;
    if (!rowFields || !baseFields) return;
    setBusy(true);
    setErr(null);
    try {
      const ai = field as { prompt: string; outputKind: "text" | "longtext" | "number" | "bool" | "select"; model?: string };
      const { runAIColumn } = await import("@/lib/ai/run-ai-column");
      const res = await runAIColumn({
        prompt: ai.prompt,
        outputKind: ai.outputKind,
        model: ai.model,
        rowFields,
        fieldDefs: baseFields,
      });
      onChange(res.value);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const isEmpty = value === null || value === undefined || value === "";
  return (
    <span className="flex w-full items-center gap-1.5">
      <span className="flex-1 truncate">
        {isEmpty ? (
          <span style={{ color: "var(--text-muted)" }}>—</span>
        ) : (
          <span>{Array.isArray(value) ? value.join(", ") : String(value)}</span>
        )}
      </span>
      <button
        type="button"
        className="rounded px-1 py-0.5 text-[10px] hover:bg-[var(--surface-2)]"
        style={{ color: "var(--accent)" }}
        title={err ?? (busy ? "Génération…" : "Regénérer via Ollama")}
        onClick={(e) => {
          e.stopPropagation();
          void run();
        }}
        disabled={busy || !rowFields || !baseFields}
      >
        {busy ? "…" : "✨"}
      </button>
    </span>
  );
}

// Égalité tolérante aux tableaux (multiselect) et primitifs. Objet structurés
// (file meta) tombent sur Object.is — comparaison par référence, on accepte
// que le pending reste actif jusqu'au prochain edit dans ces cas rares.
function cellValueEq(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!Object.is(a[i], b[i])) return false;
    return true;
  }
  return false;
}

// Memoize aggressively : la grille re-render à chaque mutation (invalidation
// cache). Sans memo, N rows × M colonnes re-renderent même quand seule une
// cellule a changé. On compare uniquement les props significatifs ; field
// peut changer de référence sans muter ses propriétés (useMemo en amont
// reconstruit la map à chaque base.fields).
export const Cell = memo(CellInner, (a, b) => {
  if (a.value !== b.value) return false;
  if (a.readOnly !== b.readOnly) return false;
  if (a.onChange !== b.onChange) return false;
  if (a.forceEditKey !== b.forceEditKey) return false;
  if (a.field === b.field) return true;
  // Comparaison shallow sur les attributs visibles d'un Field.
  return (
    a.field.id === b.field.id &&
    a.field.name === b.field.name &&
    a.field.label === b.field.label &&
    a.field.kind === b.field.kind
  );
});

// ── Display ─────────────────────────────────────────────────────────────────

const MONTHS_SHORT_FR = [
  "janv.", "févr.", "mars", "avr.", "mai", "juin",
  "juil.", "août", "sept.", "oct.", "nov.", "déc.",
];
/** Applique un patron type "DD/MM/YYYY", "DD MMM YYYY", "YYYY-MM-DD HH:mm". */
function applyDatePattern(d: Date, pattern: string): string {
  return pattern
    .replace("YYYY", String(d.getFullYear()).padStart(4, "0"))
    .replace("MMM", MONTHS_SHORT_FR[d.getMonth()] ?? "")
    .replace("MM", String(d.getMonth() + 1).padStart(2, "0"))
    .replace("DD", String(d.getDate()).padStart(2, "0"))
    .replace("HH", String(d.getHours()).padStart(2, "0"))
    .replace("mm", String(d.getMinutes()).padStart(2, "0"));
}

function CellDisplay({ field, value }: { field: Field; value: unknown }) {
  if (value === null || value === undefined || value === "") {
    return <span style={{ color: "var(--text-muted)" }}>—</span>;
  }
  switch (field.kind) {
    case "bool":
      return <span>{value ? "✓" : ""}</span>;
    case "date":
    case "datetime":
    case "createdAt":
    case "updatedAt": {
      const isDateTime = field.kind === "datetime" || field.kind === "createdAt" || field.kind === "updatedAt";
      const fmt = (field as { format?: string }).format;
      if (fmt) {
        const d = value instanceof Date ? value : new Date(String(value));
        if (!isNaN(d.getTime())) return <span>{applyDatePattern(d, fmt)}</span>;
      }
      return <span>{formatDate(value, isDateTime)}</span>;
    }
    case "select":
    case "status": {
      const opt = (field as { options: SelectOption[] }).options.find(
        (o) => o.value === String(value),
      );
      if (!opt) return <span>{String(value)}</span>;
      return (
        <span
          className="rounded px-1.5 py-0.5 text-xs font-medium"
          style={{
            backgroundColor: (opt.color ?? "#64748B") + "22",
            color: opt.color ?? "var(--text-primary)",
          }}
        >
          {opt.label}
        </span>
      );
    }
    case "multiselect": {
      const arr = asStringArray(value);
      const opts = (field as { options: SelectOption[] }).options;
      return (
        <div className="flex flex-wrap gap-1">
          {arr.map((v) => {
            const opt = opts.find((o) => o.value === v);
            return (
              <span
                key={v}
                className="rounded px-1.5 py-0.5 text-xs"
                style={{
                  backgroundColor: (opt?.color ?? "#64748B") + "22",
                  color: opt?.color ?? "var(--text-primary)",
                }}
              >
                {opt?.label ?? v}
              </span>
            );
          })}
        </div>
      );
    }
    case "url":
      return (
        <a
          href={String(value)}
          target="_blank"
          rel="noreferrer"
          className="underline"
          style={{ color: "var(--accent)" }}
          onClick={(e) => e.stopPropagation()}
        >
          {String(value)}
        </a>
      );
    case "email":
      return (
        <a
          href={`mailto:${String(value)}`}
          className="underline"
          style={{ color: "var(--accent)" }}
          onClick={(e) => e.stopPropagation()}
        >
          {String(value)}
        </a>
      );
    case "rating": {
      const max = Math.max(1, Math.min(10, (field as { max?: number }).max ?? 5));
      const n = Math.max(0, Math.min(max, Math.round(Number(value) || 0)));
      return <span style={{ color: "var(--warning)" }}>{"★".repeat(n) + "☆".repeat(max - n)}</span>;
    }
    case "percent": {
      const prec = (field as { precision?: number }).precision ?? 0;
      const n = Number(value) || 0;
      return <span className="tabular-nums">{n.toFixed(prec)}%</span>;
    }
    case "currency": {
      const code = (field as { currencyCode?: string }).currencyCode || "EUR";
      const prec = (field as { precision?: number }).precision ?? 2;
      const n = Number(value) || 0;
      try {
        return (
          <span className="tabular-nums">
            {n.toLocaleString(undefined, { style: "currency", currency: code, minimumFractionDigits: prec, maximumFractionDigits: prec })}
          </span>
        );
      } catch {
        return <span className="tabular-nums">{formatNumber(n, prec)} {code}</span>;
      }
    }
    case "progress": {
      const min = (field as { min?: number }).min ?? 0;
      const max = (field as { max?: number }).max ?? 100;
      const n = Number(value) || 0;
      const pct = max > min ? Math.max(0, Math.min(100, ((n - min) / (max - min)) * 100)) : 0;
      return (
        <span className="inline-flex w-full items-center gap-2">
          <span className="relative h-1.5 min-w-8 flex-1 overflow-hidden rounded-full" style={{ backgroundColor: "var(--surface-3)" }}>
            <span className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${pct}%`, backgroundColor: "var(--accent)", transition: "width var(--sn-dur-2, 150ms) var(--sn-ease-glide, ease-out)" }} />
          </span>
          <span className="shrink-0 tabular-nums text-[11px]" style={{ color: "var(--text-muted)" }}>{Math.round(pct)}%</span>
        </span>
      );
    }
    case "number":
    case "duration":
    case "autoNumber": {
      const prec = (field as { precision?: number }).precision;
      const n = Number(value) || 0;
      return <span className="tabular-nums">{prec != null ? formatNumber(n, prec) : formatNumber(n)}</span>;
    }
    case "color":
      return (
        <span className="inline-flex items-center gap-1.5">
          <span
            className="inline-block size-3 rounded"
            style={{ backgroundColor: String(value) }}
          />
          {String(value)}
        </span>
      );
    case "longtext":
    case "markdown":
      return <span className="line-clamp-2 whitespace-pre-wrap">{String(value)}</span>;
    case "relation":
      return <RelationCellDisplay field={field as RelationField} value={value} />;
    case "image": {
      const src = typeof value === "string" && value.startsWith("data:") ? value : null;
      if (!src) return <span style={{ color: "var(--text-muted)" }}>—</span>;
      return (
        <img
          src={src}
          alt=""
          className="max-h-8 max-w-full rounded object-cover"
        />
      );
    }
    case "file": {
      const meta = parseFileMeta(value);
      if (!meta) return <span style={{ color: "var(--text-muted)" }}>—</span>;
      return (
        <span className="flex items-center gap-1 text-xs" style={{ color: "var(--accent)" }}>
          📎 {meta.name}
        </span>
      );
    }
    case "formula": {
      if (value === null || value === undefined || value === "") {
        return <span style={{ color: "var(--text-muted)" }}>—</span>;
      }
      if (typeof value === "string" && value.startsWith("#ERREUR")) {
        const msg = value.replace(/^#ERREUR:?\s*/, "") || "Erreur d'évaluation";
        return <span title={msg} style={{ color: "var(--destructive)" }}>#ERREUR</span>;
      }
      const out = (field as { outputKind?: string }).outputKind ?? "text";
      const fmt = (field as { outputFormat?: string }).outputFormat;
      if (out === "number") {
        const n = typeof value === "number" ? value : Number(value);
        if (isNaN(n)) return <span>{String(value)}</span>;
        let formatted = n.toLocaleString();
        if (fmt) {
          const m = fmt.match(/^decimals:(\d+)$/);
          if (m) formatted = n.toLocaleString(undefined, { minimumFractionDigits: +m[1]!, maximumFractionDigits: +m[1]! });
          else if (fmt === "percent") formatted = (n * 100).toLocaleString(undefined, { maximumFractionDigits: 2 }) + " %";
          else if (fmt.startsWith("currency:")) formatted = n.toLocaleString(undefined, { style: "currency", currency: fmt.slice(9) });
        }
        return <span className="font-mono tabular-nums">{formatted}</span>;
      }
      if (out === "bool") {
        const truthy = value === true || value === "true" || value === 1;
        return (
          <span
            className="inline-flex h-4 w-4 items-center justify-center rounded text-[10px]"
            style={{ backgroundColor: truthy ? "var(--accent)" : "var(--surface-2)", color: truthy ? "var(--accent-foreground)" : "var(--text-muted)" }}
          >
            {truthy ? "✓" : ""}
          </span>
        );
      }
      if (out === "date") {
        const d = value instanceof Date ? value : new Date(String(value));
        if (isNaN(d.getTime())) return <span>{String(value)}</span>;
        if (fmt && fmt.startsWith("date:")) {
          const pat = fmt.slice(5);
          const s = pat
            .replace("YYYY", String(d.getFullYear()).padStart(4, "0"))
            .replace("MM", String(d.getMonth() + 1).padStart(2, "0"))
            .replace("DD", String(d.getDate()).padStart(2, "0"))
            .replace("HH", String(d.getHours()).padStart(2, "0"))
            .replace("mm", String(d.getMinutes()).padStart(2, "0"));
          return <span>{s}</span>;
        }
        return <span>{d.toLocaleDateString()}</span>;
      }
      return <span>{String(value)}</span>;
    }
    case "rollup":
    case "lookup":
      return (
        <span style={{ color: "var(--text-muted)" }}>
          {value === null || value === undefined ? "—" : Array.isArray(value) ? value.join(", ") : String(value)}
        </span>
      );
    default:
      return <span>{String(value)}</span>;
  }
}

// ── Select / Status editor (popover coloré + recherche) ──────────────────────
//
// Remplace le <select> natif : panneau ancré sous la cellule (portal), options
// colorées avec pastille, recherche, commit au clic. Réutilise les styles
// `.sn-col-menu`. Le blur de la recherche (clic extérieur) annule ; les clics
// d'option gardent le focus via mousedown preventDefault.

function SelectCellEditor({
  field,
  value,
  onCommit,
  onCancel,
}: {
  field: Field;
  value: unknown;
  onCommit: (v: FieldValue) => void;
  onCancel: () => void;
}) {
  const opts = (field as { options?: SelectOption[] }).options ?? [];
  const [search, setSearch] = useState("");
  const anchorRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; width: number } | null>(null);

  useLayoutEffect(() => {
    const el = anchorRef.current;
    if (!el) return;
    const update = () => {
      const r = el.getBoundingClientRect();
      setPos({ left: r.left, top: r.bottom, width: r.width });
    };
    update();
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, []);

  // Annulation au clic extérieur (anchor + panneau portal exclus). Plus robuste
  // que `onBlur` qui se déclenchait AVANT le clic d'option → commit perdu.
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (anchorRef.current?.contains(t) || panelRef.current?.contains(t)) return;
      onCancel();
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [onCancel]);

  const cur = String(value ?? "");
  const q = search.trim().toLowerCase();
  const filtered = q ? opts.filter((o) => o.label.toLowerCase().includes(q)) : opts;
  const curOpt = opts.find((o) => o.value === cur);

  return (
    <div ref={anchorRef} className="flex h-full w-full items-center px-3 outline-none ring-2 ring-[var(--accent)]">
      {curOpt ? (
        <span
          className="rounded px-1.5 py-0.5 text-xs font-medium"
          style={{ backgroundColor: (curOpt.color ?? "#64748B") + "22", color: curOpt.color ?? "var(--text-primary)" }}
        >
          {curOpt.label}
        </span>
      ) : (
        <span style={{ color: "var(--text-muted)" }}>—</span>
      )}
      {pos &&
        createPortal(
          <div
            ref={panelRef}
            className="sn-col-menu"
            style={{ position: "fixed", left: pos.left, top: pos.top + 2, minWidth: Math.max(190, pos.width), zIndex: 9999 }}
            role="listbox"
          >
            <input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") { e.preventDefault(); onCancel(); }
                else if (e.key === "Enter") { e.preventDefault(); const f = filtered[0]; if (f) onCommit(f.value as FieldValue); }
              }}
              placeholder="Rechercher…"
              className="sn-col-menu-rename-input"
              aria-label="Rechercher une option"
            />
            <div className="sn-col-menu-separator" />
            <div style={{ maxHeight: 220, overflowY: "auto" }}>
              <button type="button" className="sn-col-menu-item" onClick={() => onCommit("" as FieldValue)}>
                <span style={{ color: "var(--text-muted)" }}>— Aucune</span>
              </button>
              {filtered.map((o) => (
                <button key={o.value} type="button" className="sn-col-menu-item" onClick={() => onCommit(o.value as FieldValue)}>
                  <span className="inline-block size-2.5 shrink-0 rounded-full" style={{ backgroundColor: o.color ?? "#64748B" }} />
                  <span style={{ color: "var(--text-primary)" }}>{o.label}</span>
                  {o.value === cur && <span className="sn-col-menu-check">✓</span>}
                </button>
              ))}
              {filtered.length === 0 && (
                <div className="px-3 py-2 text-xs" style={{ color: "var(--text-muted)" }}>Aucune option</div>
              )}
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}

// ── Editor ──────────────────────────────────────────────────────────────────

interface CellEditorProps {
  field: Field;
  value: unknown;
  onCommit: (next: FieldValue, advance?: AdvanceDir) => void;
  onCancel: () => void;
  initialChar?: string;
}

function CellEditor({ field, value, onCommit, onCancel, initialChar }: CellEditorProps) {
  const [draft, setDraft] = useState<unknown>(() =>
    initialChar !== undefined ? initialChar : (value ?? ""),
  );
  const ref = useRef<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null>(null);

  // Autofocus. Si initialChar fourni, place le caret en fin (user vient de
  // taper le 1er caractère). Sinon, sélectionne tout (remplace facile).
  useEffect(() => {
    if (!ref.current) return;
    ref.current.focus();
    if (initialChar !== undefined) {
      const el = ref.current;
      if ("setSelectionRange" in el && typeof el.value === "string") {
        const len = el.value.length;
        try {
          el.setSelectionRange(len, len);
        } catch {
          /* certains types d'input ne supportent pas setSelectionRange */
        }
      }
    } else if ("select" in ref.current) {
      ref.current.select();
    }
  }, [initialChar]);

  const commit = (advance?: AdvanceDir) => onCommit(draft as FieldValue, advance);

  // Common keyboard handler: Tab / Enter commit + advance ; Shift+Tab et
  // Shift+Enter naviguent à l'envers ; Escape annule.
  const keyHandler = (
    e: React.KeyboardEvent<HTMLElement>,
    opts?: { multiline?: boolean },
  ) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
      return;
    }
    if (e.key === "Tab") {
      e.preventDefault();
      commit(e.shiftKey ? "shift-tab" : "tab");
      return;
    }
    if (e.key === "Enter") {
      // En multiligne, Enter insère un \n ; Shift+Enter / Cmd+Enter commit.
      if (opts?.multiline && !e.metaKey && !e.ctrlKey && !e.shiftKey) return;
      e.preventDefault();
      commit(e.shiftKey ? "shift-enter" : "enter");
    }
  };

  // Le centrage vertical natif d'un <input h-full> échoue dans un <td>
  // (vertical-align:top) → caret en haut. On reprend EXACTEMENT le conteneur
  // de la cellule d'affichage (`flex h-full items-center px-3`), qui lui centre
  // correctement : l'input devient un enfant auto-hauteur centré par le flex.
  const CELL_EDIT_WRAP = "flex h-full w-full items-center px-3 outline-none ring-2 ring-[var(--accent)]";
  const baseInputClass = "w-full bg-transparent text-[13.5px] outline-none";

  switch (field.kind) {
    case "longtext":
    case "markdown":
      return (
        <textarea
          ref={(el) => {
            ref.current = el;
          }}
          className="h-full w-full bg-transparent px-3 py-1.5 text-[13.5px] outline-none ring-2 ring-[var(--accent)]"
          rows={3}
          value={String(draft ?? "")}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => commit()}
          onKeyDown={(e) => keyHandler(e, { multiline: true })}
        />
      );
    case "number":
    case "currency":
    case "percent":
    case "duration": {
      const nf = field as { min?: number; max?: number; precision?: number };
      const step = nf.precision != null && nf.precision > 0 ? 1 / 10 ** nf.precision : "any";
      const clampCommit = (advance?: AdvanceDir) => {
        let out: FieldValue = draft as FieldValue;
        if (typeof draft === "number" && Number.isFinite(draft)) {
          let n = draft;
          if (nf.min != null) n = Math.max(nf.min, n);
          if (nf.max != null) n = Math.min(nf.max, n);
          out = n as FieldValue;
        }
        onCommit(out, advance);
      };
      return (
        <div className={CELL_EDIT_WRAP}>
          <input
            ref={(el) => {
              ref.current = el;
            }}
            type="number"
            step={step}
            min={nf.min}
            max={nf.max}
            className={`${baseInputClass} tabular-nums`}
            value={String(draft ?? "")}
            onChange={(e) => setDraft(e.target.value === "" ? "" : Number(e.target.value))}
            onBlur={() => clampCommit()}
            onKeyDown={(e) => {
              if (e.key === "Escape") { e.preventDefault(); onCancel(); return; }
              if (e.key === "Tab") { e.preventDefault(); clampCommit(e.shiftKey ? "shift-tab" : "tab"); return; }
              if (e.key === "Enter") { e.preventDefault(); clampCommit(e.shiftKey ? "shift-enter" : "enter"); }
            }}
          />
        </div>
      );
    }
    case "rating": {
      const max = Math.max(1, Math.min(10, (field as { max?: number }).max ?? 5));
      const cur = Math.round(Number(draft) || 0);
      return (
        <div
          className="flex h-full w-full items-center gap-0.5 px-3 outline-none ring-2 ring-[var(--accent)]"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Escape") { e.preventDefault(); onCancel(); }
            else if (e.key === "ArrowRight") { e.preventDefault(); setDraft(Math.min(max, cur + 1)); }
            else if (e.key === "ArrowLeft") { e.preventDefault(); setDraft(Math.max(0, cur - 1)); }
            else if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); onCommit(cur as FieldValue, e.key === "Tab" ? (e.shiftKey ? "shift-tab" : "tab") : undefined); }
          }}
          ref={(el) => { if (el && !el.dataset.focused) { el.dataset.focused = "1"; el.focus(); } }}
        >
          {Array.from({ length: max }, (_, i) => i + 1).map((n) => (
            <button
              key={n}
              type="button"
              className="text-base leading-none transition-transform hover:scale-110"
              style={{ color: n <= cur ? "var(--warning)" : "var(--text-muted)" }}
              onClick={() => onCommit(n as FieldValue)}
              aria-label={`Note ${n}/${max}`}
            >
              {n <= cur ? "★" : "☆"}
            </button>
          ))}
          {cur > 0 && (
            <button
              type="button"
              className="ml-1 text-[10px]"
              style={{ color: "var(--text-muted)" }}
              onClick={() => onCommit(0 as FieldValue)}
              aria-label="Effacer la note"
            >
              ✕
            </button>
          )}
        </div>
      );
    }
    case "progress": {
      const min = (field as { min?: number }).min ?? 0;
      const max = (field as { max?: number }).max ?? 100;
      const raw = Number(draft);
      const val = Number.isFinite(raw) ? Math.max(min, Math.min(max, raw)) : min;
      const pct = max > min ? Math.round(((val - min) / (max - min)) * 100) : 0;
      return (
        <div className="flex h-full w-full items-center gap-2 px-3 outline-none ring-2 ring-[var(--accent)]">
          <input
            type="range"
            min={min}
            max={max}
            step="any"
            value={val}
            autoFocus
            className="flex-1 accent-[var(--accent)]"
            onChange={(e) => setDraft(Number(e.target.value))}
            onBlur={() => commit()}
            onKeyDown={(e) => {
              if (e.key === "Escape") { e.preventDefault(); onCancel(); }
              else if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); commit(e.key === "Tab" ? (e.shiftKey ? "shift-tab" : "tab") : "enter"); }
            }}
          />
          <span className="w-9 shrink-0 text-right tabular-nums text-[11px]" style={{ color: "var(--text-muted)" }}>{pct}%</span>
        </div>
      );
    }
    case "bool":
      return (
        <input
          ref={(el) => {
            ref.current = el;
          }}
          type="checkbox"
          className="mx-2"
          checked={!!draft}
          onChange={(e) => {
            const next = e.target.checked;
            setDraft(next);
            // Booleans commit immediately — no need to wait for blur.
            onCommit(next);
          }}
          onKeyDown={keyHandler}
        />
      );
    case "date":
    case "datetime":
      return (
        <div className={CELL_EDIT_WRAP}>
          <input
            ref={(el) => {
              ref.current = el;
            }}
            type={field.kind === "datetime" ? "datetime-local" : "date"}
            className={baseInputClass}
            value={toInputDate(draft, field.kind === "datetime")}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => commit()}
            onKeyDown={keyHandler}
          />
        </div>
      );
    case "select":
    case "status":
      return (
        <SelectCellEditor
          field={field}
          value={draft}
          onCommit={(v) => onCommit(v)}
          onCancel={onCancel}
        />
      );
    case "multiselect": {
      const opts = (field as { options: SelectOption[] }).options;
      const selected = new Set(asStringArray(draft));
      return (
        <div className="flex max-w-full flex-wrap gap-1 p-1 ring-2 ring-[var(--accent)]">
          {opts.map((o) => {
            const isOn = selected.has(o.value);
            return (
              <button
                key={o.value}
                type="button"
                onClick={() => {
                  const next = new Set(selected);
                  if (isOn) next.delete(o.value);
                  else next.add(o.value);
                  setDraft(Array.from(next));
                }}
                className="rounded px-1.5 py-0.5 text-xs"
                style={{
                  backgroundColor: isOn ? (o.color ?? "#64748B") + "33" : "transparent",
                  color: o.color ?? "var(--text-primary)",
                  border: `1px solid ${o.color ?? "var(--border-subtle)"}`,
                }}
              >
                {o.label}
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => commit()}
            className="ml-auto text-xs underline"
            style={{ color: "var(--accent)" }}
          >
            OK
          </button>
        </div>
      );
    }
    case "relation":
      return (
        <RelationPicker
          field={field as RelationField}
          value={draft}
          onCommit={(next) => onCommit(next as FieldValue)}
          onCancel={onCancel}
        />
      );
    case "image":
      return (
        <ImageEditor
          value={draft}
          onCommit={onCommit}
          onCancel={onCancel}
        />
      );
    case "file":
      return (
        <FileEditor
          value={draft}
          onCommit={onCommit}
          onCancel={onCancel}
        />
      );
    default:
      // text, url, email, phone, color, …
      return (
        <div className={CELL_EDIT_WRAP}>
          <input
            ref={(el) => {
              ref.current = el;
            }}
            type="text"
            className={baseInputClass}
            value={String(draft ?? "")}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => commit()}
            onKeyDown={keyHandler}
          />
        </div>
      );
  }
}

// ── RelationCellDisplay ────────────────────────────────────────────────────
//
// Shows entity chips in read mode. Fetches entity titles for the target type
// once (React Query caches per typeId) and resolves stored IDs client-side.

function RelationCellDisplay({ field, value }: { field: RelationField; value: unknown }) {
  const ids = useMemo(() => {
    if (!value) return [];
    if (Array.isArray(value)) return value.map(String).filter(Boolean);
    if (typeof value === "string") {
      if (value.startsWith("[")) {
        try { return (JSON.parse(value) as unknown[]).map(String).filter(Boolean); } catch { /* fall through */ }
      }
      return value ? [value] : [];
    }
    return [];
  }, [value]);

  // Liste plus large par défaut (couvre la plupart des bases).
  const { data } = trpc.entities.search.useQuery(
    { query: " ", typeId: field.targetTypeId, limit: 500 },
    { enabled: ids.length > 0 },
  );

  const byId = useMemo(
    () => new Map((data?.items ?? []).map((e) => [e.id, e])),
    [data],
  );

  // Fallback : pour les IDs manquants (base très grande), fetch par id.
  const missingIds = useMemo(
    () => ids.filter((id) => !byId.has(id)),
    [ids, byId],
  );

  if (ids.length === 0) return <span style={{ color: "var(--text-muted)" }}>—</span>;

  return (
    <div className="flex flex-wrap gap-1">
      {ids.map((id) => {
        const entity = byId.get(id);
        if (entity) {
          const label = String(entity.fields["name"] ?? entity.fields["title"] ?? entity.filePath.split("/").pop()?.replace(/\.md$/i, "") ?? id.slice(0, 8));
          return <RelationChip key={id} label={label} />;
        }
        return <RelationChipLazy key={id} id={id} fetch={missingIds.includes(id)} />;
      })}
    </div>
  );
}

function RelationChip({ label }: { label: string }) {
  return (
    <span
      className="rounded px-1.5 py-0.5 text-xs"
      style={{ backgroundColor: "var(--accent)" + "22", color: "var(--accent)" }}
    >
      ↔ {label}
    </span>
  );
}

function RelationChipLazy({ id, fetch }: { id: string; fetch: boolean }) {
  const { data } = trpc.entities.get.useQuery({ id }, { enabled: fetch });
  if (!data) return <RelationChip label={id.slice(0, 8) + "…"} />;
  const label = String(
    data.fields["name"] ?? data.fields["title"] ?? data.filePath.split("/").pop()?.replace(/\.md$/i, "") ?? id.slice(0, 8),
  );
  return <RelationChip label={label} />;
}

// ── ImageEditor ────────────────────────────────────────────────────────────

const MAX_IMAGE_BYTES = 512 * 1024; // 512 KB

function ImageEditor({
  value,
  onCommit,
  onCancel,
}: {
  value: unknown;
  onCommit: (next: FieldValue) => void;
  onCancel: () => void;
}) {
  const [preview, setPreview] = useState<string | null>(
    typeof value === "string" && value.startsWith("data:") ? value : null,
  );

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > MAX_IMAGE_BYTES) {
      alert(`Image trop volumineuse (max ${MAX_IMAGE_BYTES / 1024} Ko).`);
      return;
    }
    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUrl = ev.target?.result as string;
      setPreview(dataUrl);
      onCommit(dataUrl);
    };
    reader.readAsDataURL(file);
  };

  return (
    <div
      className="flex flex-col gap-2 p-2 ring-2 ring-[var(--accent)]"
      style={{ backgroundColor: "var(--surface-1)" }}
    >
      {preview && (
        <img src={preview} alt="" className="max-h-24 max-w-full rounded object-contain" />
      )}
      <input type="file" accept="image/*" onChange={handleFile} className="text-xs" />
      <div className="flex justify-end gap-2">
        {preview && (
          <button
            type="button"
            className="text-xs"
            style={{ color: "var(--destructive)" }}
            onClick={() => { setPreview(null); onCommit(null); }}
          >
            Supprimer
          </button>
        )}
        <button
          type="button"
          className="text-xs"
          style={{ color: "var(--text-muted)" }}
          onClick={onCancel}
        >
          Annuler
        </button>
      </div>
    </div>
  );
}

// ── FileEditor ─────────────────────────────────────────────────────────────

const MAX_FILE_BYTES = 1024 * 1024; // 1 MB

interface FileMeta { name: string; type: string; size: number; data: string }

function parseFileMeta(value: unknown): FileMeta | null {
  if (!value) return null;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed) && "name" in parsed) {
        return parsed as FileMeta;
      }
    } catch { /* fall through */ }
  }
  return null;
}

function FileEditor({
  value,
  onCommit,
  onCancel,
}: {
  value: unknown;
  onCommit: (next: FieldValue) => void;
  onCancel: () => void;
}) {
  const [current, setCurrent] = useState<FileMeta | null>(() => parseFileMeta(value));

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) {
      alert(`Fichier trop volumineux (max ${MAX_FILE_BYTES / 1024} Ko).`);
      return;
    }
    const reader = new FileReader();
    reader.onload = (ev) => {
      const meta: FileMeta = {
        name: file.name,
        type: file.type,
        size: file.size,
        data: ev.target?.result as string,
      };
      setCurrent(meta);
      onCommit(JSON.stringify(meta));
    };
    reader.readAsDataURL(file);
  };

  const download = () => {
    if (!current) return;
    const a = document.createElement("a");
    a.href = current.data;
    a.download = current.name;
    a.click();
  };

  return (
    <div
      className="flex flex-col gap-2 p-2 ring-2 ring-[var(--accent)]"
      style={{ backgroundColor: "var(--surface-1)" }}
    >
      {current && (
        <div className="flex items-center gap-2 text-xs">
          <span className="flex-1 truncate" style={{ color: "var(--text-primary)" }}>
            📎 {current.name}
          </span>
          <button
            type="button"
            onClick={download}
            className="underline"
            style={{ color: "var(--accent)" }}
          >
            Télécharger
          </button>
        </div>
      )}
      <input type="file" onChange={handleFile} className="text-xs" />
      <div className="flex justify-end gap-2">
        {current && (
          <button
            type="button"
            className="text-xs"
            style={{ color: "var(--destructive)" }}
            onClick={() => { setCurrent(null); onCommit(null); }}
          >
            Supprimer
          </button>
        )}
        <button
          type="button"
          className="text-xs"
          style={{ color: "var(--text-muted)" }}
          onClick={onCancel}
        >
          Annuler
        </button>
      </div>
    </div>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────

function asStringArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String);
  if (typeof v === "string" && v.length > 0) {
    if (v.startsWith("[")) {
      try {
        const parsed = JSON.parse(v) as unknown;
        if (Array.isArray(parsed)) return parsed.map(String);
      } catch {
        /* fall through */
      }
    }
    return v.split(",").map((s) => s.trim()).filter(Boolean);
  }
  return [];
}

function formatNumber(n: number, digits = 0): string {
  if (!Number.isFinite(n)) return "";
  return n.toLocaleString("fr-FR", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function formatDate(v: unknown, withTime: boolean): string {
  if (!v) return "";
  const d = v instanceof Date ? v : new Date(String(v));
  if (Number.isNaN(d.getTime())) return String(v);
  return d.toLocaleString("fr-FR", {
    dateStyle: "short",
    ...(withTime ? { timeStyle: "short" } : {}),
  });
}

function toInputDate(v: unknown, withTime: boolean): string {
  if (!v) return "";
  const d = v instanceof Date ? v : new Date(String(v));
  if (Number.isNaN(d.getTime())) return "";
  // <input type="date" /> expects YYYY-MM-DD; type="datetime-local" expects
  // YYYY-MM-DDTHH:mm. ISO has timezone offset which the input strips.
  const iso = d.toISOString();
  return withTime ? iso.slice(0, 16) : iso.slice(0, 10);
}
