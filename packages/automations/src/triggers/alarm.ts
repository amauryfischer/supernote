// ============================================================
// Alarm trigger — compute fire dates from entity date fields
// ============================================================

import type { AlarmTriggerConfig } from "../types/index.js";

/** Supported offset units */
const OFFSET_PATTERN = /^([+-]?\d+)([smhdwMy])?$/;

/**
 * Parse an offset string like "-1d", "+2h", "30m" into milliseconds.
 * Supports: s=seconds, m=minutes, h=hours, d=days, w=weeks, M=months (approx), y=years (approx)
 */
export function parseOffsetMs(offset: string): number {
  if (offset === "0") return 0;
  const match = OFFSET_PATTERN.exec(offset);
  if (!match) throw new Error(`Invalid offset: ${offset}`);
  const value = parseInt(match[1] ?? "0", 10);
  const unit = match[2] ?? "ms";
  const multipliers: Record<string, number> = {
    s: 1_000,
    m: 60_000,
    h: 3_600_000,
    d: 86_400_000,
    w: 7 * 86_400_000,
    M: 30 * 86_400_000,
    y: 365 * 86_400_000,
  };
  const multiplier = multipliers[unit] ?? 1;
  return value * multiplier;
}

/**
 * Project a base date onto the year of `reference` (used for annually-recurring
 * alarms such as birthdays). Preserves month, day, hour, minute, second, ms.
 * Handles Feb-29 → Feb-28 gracefully on non-leap target years.
 */
function projectOntoYear(baseDate: Date, reference: Date): Date {
  const targetYear = reference.getFullYear();
  let projected = new Date(
    targetYear,
    baseDate.getMonth(),
    baseDate.getDate(),
    baseDate.getHours(),
    baseDate.getMinutes(),
    baseDate.getSeconds(),
    baseDate.getMilliseconds(),
  );
  // Feb-29 on a non-leap year wraps to Mar-1 via Date constructor; pull it
  // back to Feb-28 so the reminder still fires once per year.
  if (
    baseDate.getMonth() === 1 &&
    baseDate.getDate() === 29 &&
    projected.getMonth() === 2
  ) {
    projected = new Date(
      targetYear,
      1,
      28,
      baseDate.getHours(),
      baseDate.getMinutes(),
      baseDate.getSeconds(),
      baseDate.getMilliseconds(),
    );
  }
  return projected;
}

/**
 * Compute the alarm fire date given a base date (from entity field) and offset config.
 * When `config.recurAnnually` is true, the base date is first projected onto the
 * current year (and rolled to next year once past), making birthday-style alarms
 * fire every year on the same month/day.
 */
export function computeAlarmDate(
  baseDate: Date,
  config: Pick<AlarmTriggerConfig, "offset" | "recurAnnually">,
  reference: Date = new Date(),
): Date {
  const offsetMs = parseOffsetMs(config.offset);
  if (config.recurAnnually) {
    let projected = projectOntoYear(baseDate, reference);
    // If the projected + offset fire window has already passed this year,
    // roll forward to the next year so the alarm fires there instead.
    if (projected.getTime() + offsetMs < reference.getTime() - 60_000) {
      projected = projectOntoYear(baseDate, new Date(reference.getFullYear() + 1, 0, 1));
    }
    return new Date(projected.getTime() + offsetMs);
  }
  return new Date(baseDate.getTime() + offsetMs);
}

/**
 * Check if an alarm should fire at a given time for the given entity field value.
 * Uses a 1-minute window.
 */
export function alarmShouldFireAt(
  entityDateValue: Date,
  config: AlarmTriggerConfig,
  at: Date
): boolean {
  const fireDate = computeAlarmDate(entityDateValue, config, at);
  const diff = Math.abs(fireDate.getTime() - at.getTime());
  return diff <= 60_000;
}

/**
 * Extract a Date from an entity field value (string or Date).
 */
export function extractDateField(value: unknown): Date | null {
  if (value instanceof Date) return value;
  if (typeof value === "string") {
    const parsed = new Date(value);
    return isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}
