/**
 * Aggregations — row footer "Summarize" operations.
 *
 * Calcule un agrégat (sum, avg, count…) sur les valeurs d'une colonne pour la
 * vue courante. Sépare la liste des opérations applicables par FieldKind du
 * calcul lui-même pour que ColumnHeaderMenu et FooterRow puissent partager la
 * même source de vérité.
 */

import type { Field } from "@supernote/core";
import type { SummarizeOp } from "@supernote/ipc";

// ── Catégorie d'op par FieldKind ─────────────────────────────────────────────

const NUMERIC_KINDS = new Set<Field["kind"]>([
  "number",
  "currency",
  "percent",
  "rating",
  "progress",
  "duration",
  "autoNumber",
]);

const DATE_KINDS = new Set<Field["kind"]>([
  "date",
  "datetime",
  "createdAt",
  "updatedAt",
]);

const BOOL_KINDS = new Set<Field["kind"]>(["bool"]);

export function isNumericField(field: Field): boolean {
  return NUMERIC_KINDS.has(field.kind);
}

export function isDateField(field: Field): boolean {
  return DATE_KINDS.has(field.kind);
}

export function isBoolField(field: Field): boolean {
  return BOOL_KINDS.has(field.kind);
}

/** Renvoie la liste ordonnée des SummarizeOp pertinentes pour un champ. */
export function availableSummarizeOps(field: Field): SummarizeOp[] {
  const common: SummarizeOp[] = [
    "none",
    "count_all",
    "count_filled",
    "count_empty",
    "count_unique",
    "percent_filled",
    "percent_empty",
  ];
  if (isNumericField(field)) {
    return [...common, "sum", "avg", "median", "min", "max", "range"];
  }
  if (isDateField(field)) {
    return [...common, "earliest", "latest", "date_range_days"];
  }
  if (isBoolField(field)) {
    // bool : count_filled = count(true), count_empty = count(false ou null)
    return common;
  }
  return common;
}

// ── Helpers de coercition ────────────────────────────────────────────────────

function isFilled(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const n = Number(value.replace(",", "."));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function toTimestamp(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (value instanceof Date) {
    const t = value.getTime();
    return Number.isFinite(t) ? t : null;
  }
  if (typeof value === "string") {
    const t = Date.parse(value);
    return Number.isFinite(t) ? t : null;
  }
  return null;
}

function median(sorted: number[]): number {
  const n = sorted.length;
  if (n === 0) return 0;
  const mid = Math.floor(n / 2);
  return n % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

// ── Formatage ────────────────────────────────────────────────────────────────

function formatNumber(value: number, field: Field): string {
  if (!Number.isFinite(value)) return "—";
  if (field.kind === "currency") {
    const currency = (field as { currency?: string }).currency ?? "EUR";
    try {
      return new Intl.NumberFormat(undefined, {
        style: "currency",
        currency,
        maximumFractionDigits: 2,
      }).format(value);
    } catch {
      return value.toFixed(2);
    }
  }
  if (field.kind === "percent") {
    return `${(value * 100).toFixed(1)} %`;
  }
  // arrondi par défaut : 2 décimales sauf si valeur entière
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(2);
}

function formatPercent(value: number): string {
  if (!Number.isFinite(value)) return "—";
  return `${(value * 100).toFixed(0)} %`;
}

function formatDate(ts: number): string {
  try {
    return new Date(ts).toLocaleDateString();
  } catch {
    return new Date(ts).toISOString().slice(0, 10);
  }
}

// ── Calcul principal ─────────────────────────────────────────────────────────

export interface SummarizeResult {
  /** Valeur formatée prête à afficher. `null` si l'op vaut `none`. */
  label: string | null;
  /** Valeur brute (utile pour les tests / sticky tooltips). */
  raw?: number | string;
}

export function computeSummarize(
  op: SummarizeOp,
  field: Field,
  values: unknown[],
): SummarizeResult {
  if (op === "none") return { label: null };
  const n = values.length;

  // Comptages génériques (s'appliquent à toutes les kinds)
  if (op === "count_all") return { label: String(n), raw: n };
  if (op === "count_filled") {
    const count = values.reduce<number>((acc, v) => acc + (isFilled(v) ? 1 : 0), 0);
    return { label: String(count), raw: count };
  }
  if (op === "count_empty") {
    const count = values.reduce<number>((acc, v) => acc + (isFilled(v) ? 0 : 1), 0);
    return { label: String(count), raw: count };
  }
  if (op === "count_unique") {
    const seen = new Set<string>();
    for (const v of values) {
      if (!isFilled(v)) continue;
      seen.add(typeof v === "string" ? v : JSON.stringify(v));
    }
    return { label: String(seen.size), raw: seen.size };
  }
  if (op === "percent_filled") {
    if (n === 0) return { label: "—" };
    const filled = values.reduce<number>((acc, v) => acc + (isFilled(v) ? 1 : 0), 0);
    return { label: formatPercent(filled / n), raw: filled / n };
  }
  if (op === "percent_empty") {
    if (n === 0) return { label: "—" };
    const empty = values.reduce<number>((acc, v) => acc + (isFilled(v) ? 0 : 1), 0);
    return { label: formatPercent(empty / n), raw: empty / n };
  }

  // Numériques
  if (
    op === "sum" ||
    op === "avg" ||
    op === "median" ||
    op === "min" ||
    op === "max" ||
    op === "range"
  ) {
    const nums = values
      .map(toNumber)
      .filter((v): v is number => v !== null);
    if (nums.length === 0) return { label: "—" };
    if (op === "sum") {
      const s = nums.reduce((a, b) => a + b, 0);
      return { label: formatNumber(s, field), raw: s };
    }
    if (op === "avg") {
      const s = nums.reduce((a, b) => a + b, 0);
      return { label: formatNumber(s / nums.length, field), raw: s / nums.length };
    }
    if (op === "median") {
      const sorted = [...nums].sort((a, b) => a - b);
      const m = median(sorted);
      return { label: formatNumber(m, field), raw: m };
    }
    if (op === "min") {
      const m = Math.min(...nums);
      return { label: formatNumber(m, field), raw: m };
    }
    if (op === "max") {
      const m = Math.max(...nums);
      return { label: formatNumber(m, field), raw: m };
    }
    if (op === "range") {
      const r = Math.max(...nums) - Math.min(...nums);
      return { label: formatNumber(r, field), raw: r };
    }
  }

  // Dates
  if (op === "earliest" || op === "latest" || op === "date_range_days") {
    const ts = values
      .map(toTimestamp)
      .filter((v): v is number => v !== null);
    if (ts.length === 0) return { label: "—" };
    if (op === "earliest") {
      const m = Math.min(...ts);
      return { label: formatDate(m), raw: m };
    }
    if (op === "latest") {
      const m = Math.max(...ts);
      return { label: formatDate(m), raw: m };
    }
    if (op === "date_range_days") {
      const days = Math.round((Math.max(...ts) - Math.min(...ts)) / 86_400_000);
      return { label: `${days} j`, raw: days };
    }
  }

  return { label: null };
}

// ── Libellés courts pour l'UI ────────────────────────────────────────────────

export function summarizeOpLabel(op: SummarizeOp): string {
  switch (op) {
    case "none":
      return "Aucun";
    case "count_all":
      return "Compter";
    case "count_filled":
      return "Remplis";
    case "count_empty":
      return "Vides";
    case "count_unique":
      return "Uniques";
    case "percent_filled":
      return "% remplis";
    case "percent_empty":
      return "% vides";
    case "sum":
      return "Somme";
    case "avg":
      return "Moyenne";
    case "median":
      return "Médiane";
    case "min":
      return "Min";
    case "max":
      return "Max";
    case "range":
      return "Étendue";
    case "earliest":
      return "Plus tôt";
    case "latest":
      return "Plus tard";
    case "date_range_days":
      return "Plage (j)";
  }
}
