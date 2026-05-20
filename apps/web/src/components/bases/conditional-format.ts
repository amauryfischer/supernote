/**
 * Conditional formatting — applique des règles définies dans
 * `view.conditionalFormats` à la valeur d'une cellule. Renvoie le style
 * effectif (bg / fg / bold / italic) ou `null` si aucune règle ne matche.
 *
 * MVP : pas de builder UI (à venir). Les règles peuvent être créées via
 * `views.update({ conditionalFormats: [...] })` directement.
 */

import type { CFStyle, ConditionalFormatRule, FilterOp } from "@supernote/ipc";

const STRING_LIKE: ReadonlySet<FilterOp> = new Set<FilterOp>([
  "contains",
  "not_contains",
  "starts_with",
  "ends_with",
]);

function eq(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a === "string" && typeof b === "string") {
    return a.toLowerCase() === b.toLowerCase();
  }
  return false;
}

function cmp(a: unknown, b: unknown): number | null {
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "string" && typeof b === "string") {
    return a.toLowerCase().localeCompare(b.toLowerCase());
  }
  return null;
}

function matches(op: FilterOp, value: unknown, target: unknown): boolean {
  switch (op) {
    case "eq":
      return eq(value, target);
    case "neq":
      return !eq(value, target);
    case "contains":
      return STRING_LIKE.has(op)
        ? String(value ?? "").toLowerCase().includes(String(target ?? "").toLowerCase())
        : false;
    case "not_contains":
      return !String(value ?? "").toLowerCase().includes(String(target ?? "").toLowerCase());
    case "starts_with":
      return String(value ?? "").toLowerCase().startsWith(String(target ?? "").toLowerCase());
    case "ends_with":
      return String(value ?? "").toLowerCase().endsWith(String(target ?? "").toLowerCase());
    case "gt": {
      const c = cmp(value, target);
      return c !== null && c > 0;
    }
    case "lt": {
      const c = cmp(value, target);
      return c !== null && c < 0;
    }
    case "gte": {
      const c = cmp(value, target);
      return c !== null && c >= 0;
    }
    case "lte": {
      const c = cmp(value, target);
      return c !== null && c <= 0;
    }
    case "is_empty":
      return value === null || value === undefined || value === "";
    case "is_not_empty":
      return value !== null && value !== undefined && value !== "";
    case "in":
      return Array.isArray(target) && target.some((t) => eq(value, t));
    case "not_in":
      return !(Array.isArray(target) && target.some((t) => eq(value, t)));
  }
}

function mergeStyles(...styles: Array<CFStyle | undefined>): CFStyle | null {
  let merged: CFStyle | null = null;
  for (const s of styles) {
    if (!s) continue;
    merged = { ...(merged ?? {}), ...s };
  }
  return merged;
}

export interface CFResolution {
  cellStyle: CFStyle | null;
  rowStyle: CFStyle | null;
}

/**
 * Résout les règles applicables pour une cellule donnée. Sépare le style
 * "cell" (col concernée) et "row" (toute la ligne). Le caller (DataGrid /
 * Cell) applique chacun à l'élément concerné.
 *
 * @param value     valeur de la cellule (champ ciblé par le fieldId)
 * @param row       map des valeurs de la ligne complète (utile pour règles
 *                  scope="row" qui ciblent un AUTRE champ)
 * @param fieldId   id du champ rendu (= column courante)
 * @param rules     `view.conditionalFormats`
 */
export function resolveConditionalFormat(
  value: unknown,
  row: Record<string, unknown>,
  fieldId: string,
  rules: ConditionalFormatRule[],
): CFResolution {
  const cellStyles: CFStyle[] = [];
  const rowStyles: CFStyle[] = [];
  for (const r of rules) {
    if (r.enabled === false) continue;
    // La règle teste TOUJOURS le champ r.fieldId — si scope=cell, elle
    // s'applique seulement sur la colonne r.fieldId ; si scope=row, elle
    // colore toute la ligne dès qu'elle matche.
    const tested = r.fieldId === fieldId ? value : row[r.fieldId];
    if (!matches(r.op as FilterOp, tested, r.value)) continue;
    if (r.scope === "row") rowStyles.push(r.style);
    else if (r.fieldId === fieldId) cellStyles.push(r.style);
  }
  return {
    cellStyle: mergeStyles(...cellStyles),
    rowStyle: mergeStyles(...rowStyles),
  };
}

export function cfStyleToCss(style: CFStyle | null): React.CSSProperties {
  if (!style) return {};
  return {
    backgroundColor: style.bg,
    color: style.fg,
    fontWeight: style.bold ? 600 : undefined,
    fontStyle: style.italic ? "italic" : undefined,
  };
}
