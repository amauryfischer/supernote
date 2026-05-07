// ============================================================
// Seed: Birthday reminder — OS notification the day before
// ============================================================

import type { AutomationConfig } from "../types/index.js";

export interface BirthdayReminderParams {
  readonly id: string;
  /** EntityType ID for contacts/persons */
  readonly personTypeId: string;
  readonly timezone?: string;
}

/**
 * Creates a ROUTINE automation that fires an OS notification
 * the day before each contact's birthday.
 */
export function createBirthdayReminderRoutine(
  params: BirthdayReminderParams
): AutomationConfig {
  return {
    id: params.id,
    kind: "ROUTINE",
    name: "Birthday reminder",
    description: "Sends an OS notification the day before a contact's birthday",
    enabled: true,
    trigger: {
      type: "alarm",
      entityTypeId: params.personTypeId,
      dateField: "birthday",
      offset: "-1d",
      timezone: params.timezone,
    },
    actions: [
      {
        type: "notify-os",
        title: "Birthday tomorrow!",
        body: "{{entity.fields.name}}'s birthday is tomorrow ({{entity.fields.birthday}}). Consider sending a message!",
      },
      {
        type: "notify-app",
        title: "Birthday reminder",
        body: "{{entity.fields.name}} has a birthday tomorrow.",
        level: "info",
      },
    ],
  };
}
