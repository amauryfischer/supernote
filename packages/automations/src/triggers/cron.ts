// ============================================================
// Cron trigger — schedule management via cron-parser
// ============================================================

import cronParser from "cron-parser";
import type { CronTriggerConfig } from "../types/index.js";

/**
 * Validate a cron expression.
 * Returns error message or null if valid.
 */
export function validateCronExpression(expression: string): string | null {
  try {
    cronParser.parseExpression(expression);
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : "Invalid cron expression";
  }
}

/**
 * Get the next scheduled Date after `from` for a given cron config.
 */
export function getNextCronDate(
  config: CronTriggerConfig,
  from: Date = new Date()
): Date {
  const options: { currentDate: Date; tz?: string } = { currentDate: from };
  if (config.timezone) options.tz = config.timezone;
  const interval = cronParser.parseExpression(config.expression, options);
  return interval.next().toDate();
}

/**
 * Get the N next scheduled Dates after `from`.
 */
export function getNextCronDates(
  config: CronTriggerConfig,
  count: number,
  from: Date = new Date()
): Date[] {
  const options: { currentDate: Date; tz?: string } = { currentDate: from };
  if (config.timezone) options.tz = config.timezone;
  const interval = cronParser.parseExpression(config.expression, options);
  const results: Date[] = [];
  for (let i = 0; i < count; i++) {
    results.push(interval.next().toDate());
  }
  return results;
}

/**
 * Check if a cron trigger should fire at the given time (within 1-minute window).
 */
export function cronShouldFireAt(config: CronTriggerConfig, at: Date): boolean {
  const windowMs = 60_000;
  const from = new Date(at.getTime() - windowMs);
  try {
    const next = getNextCronDate(config, from);
    return next.getTime() <= at.getTime();
  } catch {
    return false;
  }
}
