/**
 * Date-format helpers backed by the user's "Format de date" preference
 * (Settings → Général → dateFormat).
 *
 * The setting only governs CALENDAR-DATE rendering — the relative branch
 * ("Aujourd'hui", "Hier", "Il y a 3 jours") is intentionally locale-bound
 * and ignores the pattern. For a "compact" calendar form (used in tight
 * badges like a todo's due-date pill), see `formatDateCompact`.
 */

import { useSettings } from "@/components/settings/SettingsContext";

/** « à l'instant », « il y a 2 min », « il y a 3 h », « il y a 4 j ». */
export function formatAgo(ms: number): string {
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 60) return "à l'instant";
  const m = Math.round(s / 60);
  if (m < 60) return `il y a ${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `il y a ${h} h`;
  return `il y a ${Math.round(h / 24)} j`;
}

export type DateFormatPattern = "DD/MM/YYYY" | "MM/DD/YYYY" | "YYYY-MM-DD";

/**
 * Format a date as the full user pattern (DD/MM/YYYY by default). Falls
 * back to the input string when it can't be parsed.
 */
export function formatDateFull(isoDate: string, pattern: string): string {
  const d = new Date(isoDate);
  if (Number.isNaN(d.getTime())) return isoDate;
  const yyyy = String(d.getFullYear());
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  switch (pattern) {
    case "MM/DD/YYYY":
      return `${mm}/${dd}/${yyyy}`;
    case "YYYY-MM-DD":
      return `${yyyy}-${mm}-${dd}`;
    case "DD/MM/YYYY":
    default:
      return `${dd}/${mm}/${yyyy}`;
  }
}

/**
 * Compact rendering — drops the year, keeps day + month respecting the
 * user's pattern order. Used in dense rows where the full year would
 * waste pixels but the month/day order should still match the user's
 * locale convention.
 *
 *   DD/MM/YYYY → "12/05"
 *   MM/DD/YYYY → "05/12"
 *   YYYY-MM-DD → "05-12"  (month-day, ISO-flavoured)
 */
export function formatDateCompact(isoDate: string, pattern: string): string {
  const d = new Date(isoDate);
  if (Number.isNaN(d.getTime())) return isoDate;
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  switch (pattern) {
    case "MM/DD/YYYY":
      return `${mm}/${dd}`;
    case "YYYY-MM-DD":
      return `${mm}-${dd}`;
    case "DD/MM/YYYY":
    default:
      return `${dd}/${mm}`;
  }
}

/**
 * React hook — returns the user's current pattern + ready-to-call
 * formatters. Use in components that need to render dates consistently
 * with the rest of the app.
 *
 * Example:
 *   const { full, compact, pattern } = useDateFormat();
 *   <span title={full(iso)}>{compact(iso)}</span>
 */
export function useDateFormat() {
  const { settings } = useSettings();
  const pattern = settings.general.dateFormat;
  return {
    pattern,
    full: (iso: string) => formatDateFull(iso, pattern),
    compact: (iso: string) => formatDateCompact(iso, pattern),
  };
}
