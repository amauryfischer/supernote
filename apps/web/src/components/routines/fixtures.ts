// ============================================================
// Mock fixtures for the Routines page
// Based on the 4 automation seeds from packages/automations
// ============================================================

export type TriggerType = "cron" | "event" | "alarm" | "webhook";
export type RunStatus = "SUCCESS" | "FAILURE" | "SKIPPED" | "RUNNING";
export type ActionType =
  | "create-mail-draft"
  | "create-entity"
  | "update-entity"
  | "create-relation"
  | "notify-os"
  | "notify-app"
  | "webhook"
  | "llm-prompt"
  | "run-script"
  | "create-inbox-note";

export interface TriggerConfig {
  type: TriggerType;
  // cron
  expression?: string;
  timezone?: string;
  // event
  eventType?: string;
  entityTypeId?: string;
  // alarm
  dateField?: string;
  offset?: string;
  // webhook
  path?: string;
  method?: string;
}

export interface ActionConfig {
  type: ActionType;
  [key: string]: unknown;
}

export interface RunRecord {
  id: string;
  status: RunStatus;
  startedAt: string;
  durationMs: number;
  error?: string;
}

export interface RoutineFixture {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  trigger: TriggerConfig;
  condition?: string;
  actions: ActionConfig[];
  nextRunAt?: string;
  lastRun?: RunRecord;
  runs: RunRecord[];
  templateKey?: TemplateKey;
}

export type TemplateKey =
  | "weekly-email"
  | "birthday-reminder"
  | "follow-up"
  | "daily-brief"
  | "blank";

export const TEMPLATE_META: Record<
  TemplateKey,
  { label: string; description: string }
> = {
  "weekly-email": {
    label: "Email hebdo contact",
    description: "Génère un brouillon d'email hebdomadaire pour un contact",
  },
  "birthday-reminder": {
    label: "Rappel d'anniversaire",
    description: "Notification OS la veille de l'anniversaire d'un contact",
  },
  "follow-up": {
    label: "Rappel relance",
    description: "Créé une note inbox pour les contacts inactifs depuis 30j+",
  },
  "daily-brief": {
    label: "Brief quotidien LLM",
    description: "Résumé IA quotidien stocké dans l'inbox via Ollama",
  },
  blank: {
    label: "Vide",
    description: "Partir de zéro et configurer son propre trigger",
  },
};

export const ROUTINES: RoutineFixture[] = [
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
      { id: "run-1c", status: "FAILURE", startedAt: "2026-04-20T09:00:30+02:00", durationMs: 1200, error: "Contact email non trouvé" },
      { id: "run-1d", status: "SUCCESS", startedAt: "2026-04-13T09:00:05+02:00", durationMs: 310 },
      { id: "run-1e", status: "SUCCESS", startedAt: "2026-04-06T09:00:07+02:00", durationMs: 298 },
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
      {
        type: "notify-app",
        title: "Rappel anniversaire",
        body: "{{entity.fields.name}} a un anniversaire demain.",
        level: "info",
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
      { id: "run-2b", status: "SUCCESS", startedAt: "2026-04-24T08:00:01+02:00", durationMs: 115 },
      { id: "run-2c", status: "SKIPPED", startedAt: "2026-04-17T08:00:00+02:00", durationMs: 45 },
    ],
  },
  {
    id: "routine-3",
    name: "Relances contacts inactifs",
    description: "Chaque lundi 8h : note inbox pour les contacts sans interaction depuis 30j+",
    enabled: true,
    templateKey: "follow-up",
    trigger: {
      type: "cron",
      expression: "0 8 * * MON",
      timezone: "Europe/Paris",
    },
    condition: "{{formula:daysAgo(now, entity.fields.lastInteraction) > 30}}",
    actions: [
      {
        type: "create-inbox-note",
        title: "Relances à faire",
        body: "Contacts sans interaction depuis 30j+ : pensez à les contacter.",
        tags: ["follow-up", "routine"],
      },
      {
        type: "notify-app",
        title: "Rappel relances",
        body: "Des contacts n'ont pas été contactés depuis plus de 30 jours.",
        level: "info",
      },
    ],
    nextRunAt: "2026-05-11T08:00:00+02:00",
    lastRun: {
      id: "run-3a",
      status: "SUCCESS",
      startedAt: "2026-05-04T08:01:10+02:00",
      durationMs: 560,
    },
    runs: [
      { id: "run-3a", status: "SUCCESS", startedAt: "2026-05-04T08:01:10+02:00", durationMs: 560 },
      { id: "run-3b", status: "SUCCESS", startedAt: "2026-04-27T08:00:45+02:00", durationMs: 480 },
      { id: "run-3c", status: "SUCCESS", startedAt: "2026-04-20T08:00:33+02:00", durationMs: 510 },
    ],
  },
  {
    id: "routine-4",
    name: "Brief quotidien LLM",
    description: "Résumé IA quotidien à 8h via Ollama (llama3), stocké dans Inbox",
    enabled: true,
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
      {
        type: "notify-app",
        title: "Brief prêt",
        body: "Votre brief quotidien est disponible dans l'inbox.",
        level: "info",
      },
    ],
    nextRunAt: "2026-05-08T08:00:00+02:00",
    lastRun: {
      id: "run-4a",
      status: "SUCCESS",
      startedAt: "2026-05-07T08:00:22+02:00",
      durationMs: 4200,
    },
    runs: [
      { id: "run-4a", status: "SUCCESS", startedAt: "2026-05-07T08:00:22+02:00", durationMs: 4200 },
      { id: "run-4b", status: "FAILURE", startedAt: "2026-05-06T08:00:11+02:00", durationMs: 8000, error: "Ollama timeout" },
      { id: "run-4c", status: "SUCCESS", startedAt: "2026-05-05T08:00:18+02:00", durationMs: 3900 },
      { id: "run-4d", status: "SUCCESS", startedAt: "2026-05-04T08:00:25+02:00", durationMs: 4100 },
      { id: "run-4e", status: "SUCCESS", startedAt: "2026-05-03T08:00:30+02:00", durationMs: 3800 },
    ],
  },
  {
    id: "routine-5",
    name: "Webhook Notion — nouvelles notes",
    description: "Envoie un webhook à Notion dès qu'une nouvelle note est créée",
    enabled: false,
    trigger: {
      type: "event",
      eventType: "entity.created",
      entityTypeId: "note",
    },
    actions: [
      {
        type: "webhook",
        url: "https://hooks.notion.com/api/v1/sync",
        method: "POST",
        body: '{"note_id": "{{entity.id}}", "title": "{{entity.fields.title}}"}',
      },
    ],
    nextRunAt: undefined,
    lastRun: {
      id: "run-5a",
      status: "FAILURE",
      startedAt: "2026-04-30T14:22:07+02:00",
      durationMs: 2100,
      error: "HTTP 401 Unauthorized",
    },
    runs: [
      { id: "run-5a", status: "FAILURE", startedAt: "2026-04-30T14:22:07+02:00", durationMs: 2100, error: "HTTP 401 Unauthorized" },
      { id: "run-5b", status: "SUCCESS", startedAt: "2026-04-29T11:04:55+02:00", durationMs: 380 },
    ],
  },
];

// ---- Helpers -------------------------------------------------------

export function formatNextRun(isoDate: string | undefined): string {
  if (!isoDate) return "—";
  const d = new Date(isoDate);
  const now = new Date();
  const diffMs = d.getTime() - now.getTime();
  const diffH = diffMs / (1000 * 60 * 60);
  if (diffH < 0) return "En retard";
  if (diffH < 1) return `Dans ${Math.round(diffH * 60)} min`;
  if (diffH < 24) return `Dans ${Math.round(diffH)}h`;
  const weekday = d.toLocaleDateString("fr-FR", { weekday: "long" });
  const hour = d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  return `${weekday} ${hour}`;
}

export function formatRunDate(isoDate: string): string {
  const d = new Date(isoDate);
  return d.toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function getBlankRoutine(id: string): RoutineFixture {
  return {
    id,
    name: "Nouvelle routine",
    description: "",
    enabled: true,
    trigger: { type: "cron", expression: "0 9 * * MON", timezone: "Europe/Paris" },
    actions: [],
    runs: [],
    templateKey: "blank",
  };
}

export function getTemplateRoutine(key: TemplateKey, id: string): RoutineFixture {
  const templates: Record<Exclude<TemplateKey, "blank">, Omit<RoutineFixture, "id" | "runs" | "lastRun" | "nextRunAt">> = {
    "weekly-email": {
      name: "Email hebdo contact",
      description: "Génère chaque lundi un brouillon email pour un contact",
      enabled: true,
      templateKey: "weekly-email",
      trigger: { type: "cron", expression: "0 9 * * MON", timezone: "Europe/Paris" },
      actions: [
        {
          type: "create-mail-draft",
          to: "contact@exemple.fr",
          subject: "Point hebdo — {{now}}",
          body: "Bonjour,\n\nVoici le récap de la semaine…\n\nCordialement",
        },
      ],
    },
    "birthday-reminder": {
      name: "Rappel anniversaires",
      description: "Notification OS la veille de chaque anniversaire",
      enabled: true,
      templateKey: "birthday-reminder",
      trigger: { type: "alarm", entityTypeId: "person", dateField: "birthday", offset: "-1d", timezone: "Europe/Paris" },
      actions: [
        { type: "notify-os", title: "Anniversaire demain !", body: "{{entity.fields.name}} fête son anniversaire demain." },
        { type: "notify-app", title: "Rappel anniversaire", body: "{{entity.fields.name}} a un anniversaire demain.", level: "info" },
      ],
    },
    "follow-up": {
      name: "Relances contacts inactifs",
      description: "Note inbox pour les contacts sans interaction depuis 30j+",
      enabled: true,
      templateKey: "follow-up",
      trigger: { type: "cron", expression: "0 8 * * MON", timezone: "Europe/Paris" },
      condition: "{{formula:daysAgo(now, entity.fields.lastInteraction) > 30}}",
      actions: [
        { type: "create-inbox-note", title: "Relances à faire", body: "Contacts inactifs depuis 30j+.", tags: ["follow-up"] },
        { type: "notify-app", title: "Rappel relances", body: "Des contacts n'ont pas été contactés depuis 30j+.", level: "info" },
      ],
    },
    "daily-brief": {
      name: "Brief quotidien LLM",
      description: "Résumé IA quotidien à 8h via Ollama",
      enabled: true,
      templateKey: "daily-brief",
      trigger: { type: "cron", expression: "0 8 * * *", timezone: "Europe/Paris" },
      actions: [
        { type: "llm-prompt", model: "llama3", prompt: "Génère un brief quotidien. Aujourd'hui : {{now}}.", storeResultAs: "dailyBrief" },
        { type: "create-inbox-note", title: "Brief — {{now}}", body: "{{trigger.dailyBrief}}", tags: ["daily-brief"] },
        { type: "notify-app", title: "Brief prêt", body: "Votre brief quotidien est dans l'inbox.", level: "info" },
      ],
    },
  };

  if (key === "blank") return getBlankRoutine(id);
  const base = templates[key];
  return { ...base, id, runs: [], lastRun: undefined, nextRunAt: undefined };
}
