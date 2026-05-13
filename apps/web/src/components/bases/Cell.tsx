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

import { useEffect, useRef, useState } from "react";
import type { Field, FieldValue, SelectOption } from "@supernote/core";

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
  "file",
  "image",
  "relation",
]);

export function Cell({ field, value, onChange, readOnly }: CellProps) {
  const [editing, setEditing] = useState(false);
  const isReadOnly = readOnly || READONLY_KINDS.has(field.kind);

  if (editing && !isReadOnly) {
    return (
      <CellEditor
        field={field}
        value={value}
        onCommit={(next) => {
          setEditing(false);
          if (next !== value) onChange(next);
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
      <CellDisplay field={field} value={value} />
    </div>
  );
}

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
      return <span style={{ color: "var(--text-muted)" }}>↔ {String(value).slice(0, 10)}…</span>;
    case "formula":
    case "rollup":
    case "lookup":
      return <span style={{ color: "var(--text-muted)" }}>{String(value)}</span>;
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
