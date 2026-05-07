// ============================================================
// Lightweight date formatter supporting date-fns-style tokens
// Supported tokens: YYYY MM DD HH mm ss EEE EEEE D MMMM MMM
// ============================================================

const DAY_NAMES_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const DAY_NAMES_LONG = [
  "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday",
] as const;
const MONTH_NAMES_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
] as const;
const MONTH_NAMES_LONG = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * Format a Date using a subset of date-fns tokens:
 *   YYYY  — 4-digit year
 *   MM    — 2-digit month (01-12)
 *   MMM   — short month name (Jan)
 *   MMMM  — full month name (January)
 *   DD    — 2-digit day of month (01-31)
 *   D     — day of month without leading zero
 *   HH    — 2-digit hour 24h (00-23)
 *   mm    — 2-digit minutes (00-59)
 *   ss    — 2-digit seconds (00-59)
 *   EEE   — short day name (Mon)
 *   EEEE  — full day name (Monday)
 */
export function formatDate(date: Date, fmt: string): string {
  const year = date.getFullYear();
  const month = date.getMonth();
  const day = date.getDate();
  const weekday = date.getDay();
  const hours = date.getHours();
  const minutes = date.getMinutes();
  const seconds = date.getSeconds();

  // Order matters: longer tokens must come first
  return fmt
    .replace(/EEEE/g, DAY_NAMES_LONG[weekday] ?? "")
    .replace(/EEE/g, DAY_NAMES_SHORT[weekday] ?? "")
    .replace(/YYYY/g, String(year))
    .replace(/MMMM/g, MONTH_NAMES_LONG[month] ?? "")
    .replace(/MMM/g, MONTH_NAMES_SHORT[month] ?? "")
    .replace(/MM/g, pad2(month + 1))
    .replace(/DD/g, pad2(day))
    .replace(/D(?![A-Z])/g, String(day))
    .replace(/HH/g, pad2(hours))
    .replace(/mm/g, pad2(minutes))
    .replace(/ss/g, pad2(seconds));
}

export const DEFAULT_DATE_FORMAT = "YYYY-MM-DD";
export const DEFAULT_TIME_FORMAT = "HH:mm";
export const DEFAULT_DATETIME_FORMAT = "YYYY-MM-DD HH:mm";
