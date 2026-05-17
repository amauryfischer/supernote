/**
 * Finance utility helpers — minimal set used by the rewritten finance pages.
 *
 * Anything chart-, snapshot- or loan-specific was deleted as part of the
 * finance section rewrite. If/when we re-introduce those features we'll add
 * their helpers back here.
 */

/**
 * Parse a user-typed decimal string supporting both English (`1234.56`) and
 * French (`1234,56`) notation. Returns `0` on empty/invalid input.
 */
export function parseDecimal(s: string): number {
  if (!s) return 0;
  const cleaned = s.replace(/\s+/g, "").replace(/,/g, ".");
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : 0;
}

export function formatCurrency(value: number): string {
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export function formatDate(iso: string): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("fr-FR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(iso));
}
