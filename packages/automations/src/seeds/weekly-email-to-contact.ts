// ============================================================
// Seed: Weekly email draft to a contact
// ============================================================

import type { AutomationConfig } from "../types/index.js";

export interface WeeklyEmailToContactParams {
  readonly id: string;
  readonly contactId: string;
  readonly subjectTemplate: string;
  readonly bodyTemplate: string;
  /** Cron expression, default: Monday at 9am */
  readonly cronExpression?: string;
  readonly timezone?: string;
}

/**
 * Creates a ROUTINE automation that generates a weekly email draft to a contact.
 * Uses `create-mail-draft` action with mailto fallback (no SMTP).
 */
export function createWeeklyEmailToContactRoutine(
  params: WeeklyEmailToContactParams
): AutomationConfig {
  return {
    id: params.id,
    kind: "ROUTINE",
    name: "Weekly email to contact",
    description: "Generates a weekly email draft for a specific contact",
    enabled: true,
    trigger: {
      type: "cron",
      expression: params.cronExpression ?? "0 9 * * MON",
      timezone: params.timezone,
    },
    actions: [
      {
        type: "create-mail-draft",
        to: `{{entity.fields.email}}`,
        subject: params.subjectTemplate,
        body: params.bodyTemplate,
      },
    ],
  };
}
