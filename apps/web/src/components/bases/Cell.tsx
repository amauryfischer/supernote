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

import { memo, useEffect, useMemo, useRef, useState } from "react";
import type { Field, FieldValue, RelationField, SelectOption } from "@supernote/core";
import { trpc } from "@/lib/trpc/client";
import { RelationPicker } from "./RelationPicker";

interface CellProps {
  field: Field;
  value: unknown;
  onChange: (next: unknown) => void;
  readOnly?: boolean;
}

const READONLY_KINDS = new Set<Field["kind"]>([
  "createdAt",
  "updatedAt",
  "createdBy",
  "autoNumber",
  "formula",
  "rollup",
  "lookup",
]);

function CellInner({ field, value, onChange, readOnly }: CellProps) {
  const [editing, setEditing] = useState(false);
  // Valeur "pending" : maintenue localement entre le commit et le moment où la
  // prop `value` rattrape (après invalidate+refetch de queryForView). Sans ça,
  // au blur le cell repasse en display mode avec l'ANCIENNE valeur de cache,
  // puis flash sur la nouvelle quand le refetch arrive.
  const [pending, setPending] = useState<{ value: unknown } | null>(null);
  const isReadOnly = readOnly || READONLY_KINDS.has(field.kind);

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
        onCommit={(next) => {
          setEditing(false);
          if (!cellValueEq(next, effectiveValue)) {
            setPending({ value: next });
            onChange(next);
          }
        }}
        onCancel={() => setEditing(false)}
      />
    );
  }

  return (
    <div
      className={`group flex h-full w-full items-center px-2 py-1 text-sm ${
        isReadOnly ? "" : "cursor-text"
      }`}
      data-cell-display=""
      onClick={() => {
        if (!isReadOnly) setEditing(true);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" && !isReadOnly) {
          e.preventDefault();
          setEditing(true);
        }
      }}
      tabIndex={isReadOnly ? -1 : 0}
      style={{ color: "var(--text-primary)" }}
    >
      <CellDisplay field={field} value={effectiveValue} />
    </div>
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
    case "updatedAt":
      return <span>{formatDate(value, field.kind === "datetime" || field.kind === "createdAt" || field.kind === "updatedAt")}</span>;
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
      const n = Math.max(0, Math.min(5, Number(value) || 0));
      return <span>{"★".repeat(n) + "☆".repeat(5 - n)}</span>;
    }
    case "percent": {
      const n = Number(value) || 0;
      return <span>{n.toFixed(0)}%</span>;
    }
    case "currency":
      return <span>{formatNumber(Number(value), 2)} €</span>;
    case "number":
    case "duration":
    case "progress":
    case "autoNumber":
      return <span>{formatNumber(Number(value))}</span>;
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

// ── Editor ──────────────────────────────────────────────────────────────────

interface CellEditorProps {
  field: Field;
  value: unknown;
  onCommit: (next: FieldValue) => void;
  onCancel: () => void;
}

function CellEditor({ field, value, onCommit, onCancel }: CellEditorProps) {
  const [draft, setDraft] = useState<unknown>(value ?? "");
  const ref = useRef<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null>(null);

  // Autofocus + select on enter so the user can type immediately, or arrow
  // into a cell and press Enter to replace its content.
  useEffect(() => {
    if (ref.current) {
      ref.current.focus();
      if ("select" in ref.current) ref.current.select();
    }
  }, []);

  const commit = () => onCommit(draft as FieldValue);

  // Common keyboard handler: Enter commits (except in longtext where Enter
  // is a newline and Shift+Enter / Cmd+Enter commits instead), Escape cancels.
  const keyHandler = (
    e: React.KeyboardEvent<HTMLElement>,
    opts?: { multiline?: boolean },
  ) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
      return;
    }
    if (e.key === "Enter") {
      if (opts?.multiline && !e.metaKey && !e.ctrlKey && !e.shiftKey) return;
      e.preventDefault();
      commit();
    }
  };

  const baseInputClass =
    "h-full w-full bg-transparent px-2 py-1 text-sm outline-none ring-2 ring-[var(--accent)]";

  switch (field.kind) {
    case "longtext":
    case "markdown":
      return (
        <textarea
          ref={(el) => {
            ref.current = el;
          }}
          className={baseInputClass}
          rows={3}
          value={String(draft ?? "")}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => keyHandler(e, { multiline: true })}
        />
      );
    case "number":
    case "currency":
    case "percent":
    case "rating":
    case "progress":
    case "duration":
      return (
        <input
          ref={(el) => {
            ref.current = el;
          }}
          type="number"
          step="any"
          className={baseInputClass}
          value={String(draft ?? "")}
          onChange={(e) => setDraft(e.target.value === "" ? "" : Number(e.target.value))}
          onBlur={commit}
          onKeyDown={keyHandler}
        />
      );
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
        <input
          ref={(el) => {
            ref.current = el;
          }}
          type={field.kind === "datetime" ? "datetime-local" : "date"}
          className={baseInputClass}
          value={toInputDate(draft, field.kind === "datetime")}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={keyHandler}
        />
      );
    case "select":
    case "status": {
      const opts = (field as { options: SelectOption[] }).options;
      return (
        <select
          ref={(el) => {
            ref.current = el;
          }}
          className={baseInputClass}
          value={String(draft ?? "")}
          onChange={(e) => {
            setDraft(e.target.value);
            onCommit(e.target.value);
          }}
          onBlur={commit}
          onKeyDown={keyHandler}
        >
          <option value="">—</option>
          {opts.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      );
    }
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
            onClick={commit}
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
        <input
          ref={(el) => {
            ref.current = el;
          }}
          type="text"
          className={baseInputClass}
          value={String(draft ?? "")}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={keyHandler}
        />
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
