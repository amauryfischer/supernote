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

// Default: empty — the app starts with no active routines.
// Use demo-fixtures.ts for demo data.
export const ROUTINES: RoutineFixture[] = [];

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
      // condition vide par défaut — l'utilisateur écrit sa formule via
      // l'éditeur (autocomplétion des fonctions, validation à la saisie).
      // Exemple à taper : DateDiff(Now(), entity.lastInteraction, 'day') > 30
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
