/**
 * Demo fixtures for routines — used by the "Charger des exemples (démo)" button in Settings > Backup.
 * These are NOT loaded by default. The app starts empty.
 */
import type { RoutineFixture } from "./fixtures";

export const DEMO_ROUTINES: RoutineFixture[] = [
  {
    id: "routine-1",
    name: "Email hebdo — Alice Martin",
    description: "Génère chaque lundi un brouillon email pour Alice Martin",
    enabled: true,
    templateKey: "weekly-email",
    trigger: {
      type: "cron",
      expression: "0 9 * * MON",
      timezone: "Europe/Paris",
    },
    actions: [
      {
        type: "create-mail-draft",
        to: "alice.martin@acme.example",
        subject: "Point hebdo — {{now}}",
        body: "Bonjour Alice,\n\nVoici le récap de la semaine…\n\nCordialement",
      },
    ],
    nextRunAt: "2026-05-11T09:00:00+02:00",
    lastRun: {
      id: "run-1a",
      status: "SUCCESS",
      startedAt: "2026-05-04T09:00:12+02:00",
      durationMs: 342,
    },
    runs: [
      { id: "run-1a", status: "SUCCESS", startedAt: "2026-05-04T09:00:12+02:00", durationMs: 342 },
      { id: "run-1b", status: "SUCCESS", startedAt: "2026-04-27T09:00:08+02:00", durationMs: 289 },
    ],
  },
  {
    id: "routine-2",
    name: "Rappel anniversaires",
    description: "Notification OS la veille de chaque anniversaire",
    enabled: true,
    templateKey: "birthday-reminder",
    trigger: {
      type: "alarm",
      entityTypeId: "person",
      dateField: "birthday",
      offset: "-1d",
      timezone: "Europe/Paris",
    },
    actions: [
      {
        type: "notify-os",
        title: "Anniversaire demain !",
        body: "{{entity.fields.name}} fête son anniversaire demain.",
      },
    ],
    nextRunAt: "2026-05-08T08:00:00+02:00",
    lastRun: {
      id: "run-2a",
      status: "SUCCESS",
      startedAt: "2026-05-06T08:00:03+02:00",
      durationMs: 120,
    },
    runs: [
      { id: "run-2a", status: "SUCCESS", startedAt: "2026-05-06T08:00:03+02:00", durationMs: 120 },
    ],
  },
  {
    id: "routine-3",
    name: "Brief quotidien LLM",
    description: "Résumé IA quotidien à 8h via Ollama (llama3), stocké dans Inbox",
    enabled: false,
    templateKey: "daily-brief",
    trigger: {
      type: "cron",
      expression: "0 8 * * *",
      timezone: "Europe/Paris",
    },
    actions: [
      {
        type: "llm-prompt",
        model: "llama3",
        prompt: "Génère un brief quotidien pour Supernote. Aujourd'hui : {{now}}.",
        storeResultAs: "dailyBrief",
      },
      {
        type: "create-inbox-note",
        title: "Brief — {{now}}",
        body: "{{trigger.dailyBrief}}",
        tags: ["daily-brief", "routine"],
      },
    ],
    nextRunAt: undefined,
    lastRun: undefined,
    runs: [],
  },
];
