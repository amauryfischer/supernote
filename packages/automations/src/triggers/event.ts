// ============================================================
// Event trigger — match domain events against trigger configs
// ============================================================

import type { DomainEvent, EventTriggerConfig } from "../types/index.js";

/**
 * Determine if a domain event matches an event trigger configuration.
 */
export function eventMatchesTrigger(
  event: DomainEvent,
  config: EventTriggerConfig
): boolean {
  if (event.type !== config.eventType) return false;
  if (config.entityTypeId && event.entityTypeId !== config.entityTypeId) {
    return false;
  }
  return true;
}
