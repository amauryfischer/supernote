// ============================================================
// Seed: Follow-up reminder — weekly check on inactive contacts
// ============================================================

import type { AutomationConfig } from "../types/index.js";

export interface FollowUpReminderParams {
  readonly id: string;
  /** EntityType ID for contacts/persons */
  readonly personTypeId: string;
  /** Days without interaction before follow-up is suggested */
  readonly inactiveDaysThreshold?: number;
  /** Cron expression, default: every Monday at 8am */
  readonly cronExpression?: string;
  readonly timezone?: string;
}

/**
 * Creates a ROUTINE automation that runs weekly, queries persons
 * without recent interaction, and generates a follow-up inbox note.
 * The condition uses a formula to filter contacts.
 */
export function createFollowUpReminderRoutine(
  params: FollowUpReminderParams
): AutomationConfig {
  const days = params.inactiveDaysThreshold ?? 30;
  return {
    id: params.id,
    kind: "ROUTINE",
    name: "Follow-up reminder",
    description: `Reminds you to follow up with contacts inactive for ${days}+ days`,
    enabled: true,
    trigger: {
      type: "cron",
      expression: params.cronExpression ?? "0 8 * * MON",
      timezone: params.timezone,
    },
    condition: `{{formula:daysAgo(now, entity.fields.lastInteraction) > ${days}}}`,
    actions: [
      {
        type: "create-inbox-note",
        title: "Follow-up needed",
        body: `Weekly follow-up check: Consider reaching out to contacts you haven't interacted with in ${days}+ days.\n\nRun this: check your Persons view filtered by last interaction.`,
        tags: ["follow-up", "routine"],
      },
      {
        type: "notify-app",
        title: "Follow-up reminder",
        body: `You may have contacts without interaction in ${days}+ days. Check your follow-up list.`,
        level: "info",
      },
    ],
  };
}
