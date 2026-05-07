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
 * Compute the alarm fire date given a base date (from entity field) and offset config.
 */
export function computeAlarmDate(
  baseDate: Date,
  config: Pick<AlarmTriggerConfig, "offset">
): Date {
  const offsetMs = parseOffsetMs(config.offset);
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
  const fireDate = computeAlarmDate(entityDateValue, config);
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
