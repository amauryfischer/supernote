"use client";

import type { TriggerConfig, TriggerType } from "./fixtures";

interface TriggerBuilderProps {
  trigger: TriggerConfig;
  onChange: (trigger: TriggerConfig) => void;
}

const TRIGGER_TYPES: { value: TriggerType; label: string }[] = [
  { value: "cron", label: "Cron (planifié)" },
  { value: "event", label: "Événement" },
  { value: "alarm", label: "Alarme" },
  { value: "webhook", label: "Webhook" },
];

const CRON_PRESETS = [
  { label: "Chaque jour à 8h", value: "0 8 * * *" },
  { label: "Chaque lundi à 9h", value: "0 9 * * MON" },
  { label: "Chaque lundi à 8h", value: "0 8 * * MON" },
  { label: "1er du mois à 9h", value: "0 9 1 * *" },
  { label: "Toutes les heures", value: "0 * * * *" },
  { label: "Personnalisé", value: "custom" },
];

const EVENT_TYPES = [
  { value: "entity.created", label: "Entité créée" },
  { value: "entity.updated", label: "Entité mise à jour" },
  { value: "entity.deleted", label: "Entité supprimée" },
  { value: "workflow.transitioned", label: "Workflow transitionné" },
  { value: "relation.created", label: "Relation créée" },
];

const ENTITY_TYPES = [
  { value: "person", label: "Personne" },
  { value: "note", label: "Note" },
  { value: "project", label: "Projet" },
  { value: "task", label: "Tâche" },
  { value: "organisation", label: "Organisation" },
];

function inputClass() {
  return "w-full rounded-md border px-3 py-2 text-sm outline-none focus:border-[var(--accent)] transition-colors";
}

function inputStyle() {
  return {
    backgroundColor: "var(--surface-0)",
    borderColor: "var(--border)",
    color: "var(--text-primary)",
  };
}

function selectClass() {
  return "w-full rounded-md border px-3 py-2 text-sm outline-none focus:border-[var(--accent)] transition-colors cursor-pointer";
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium" style={{ color: "var(--text-muted)" }}>
        {label}
      </label>
      {children}
    </div>
  );
}

function CronBuilder({ trigger, onChange }: { trigger: TriggerConfig; onChange: (t: TriggerConfig) => void }) {
  const expr = trigger.expression ?? "0 9 * * MON";
  const preset = CRON_PRESETS.find((p) => p.value === expr);
  const isCustom = !preset || preset.value === "custom";

  function handlePreset(value: string) {
    if (value === "custom") return;
    onChange({ ...trigger, expression: value });
  }

  return (
    <div className="space-y-3">
      <Field label="Fréquence">
        <select
          className={selectClass()}
          style={inputStyle()}
          value={isCustom ? "custom" : expr}
          onChange={(e) => handlePreset(e.target.value)}
        >
          {CRON_PRESETS.map((p) => (
            <option key={p.value} value={p.value}>{p.label}</option>
          ))}
        </select>
      </Field>
      <Field label="Expression cron">
        <input
          type="text"
          className={inputClass()}
          style={inputStyle()}
          value={expr}
          onChange={(e) => onChange({ ...trigger, expression: e.target.value })}
          placeholder="0 9 * * MON"
          spellCheck={false}
        />
        <p className="mt-1 text-[10px]" style={{ color: "var(--text-muted)" }}>
          Format : minute heure jour mois jour_semaine — ex : 0 9 * * MON
        </p>
      </Field>
      <Field label="Fuseau horaire">
        <input
          type="text"
          className={inputClass()}
          style={inputStyle()}
          value={trigger.timezone ?? "Europe/Paris"}
          onChange={(e) => onChange({ ...trigger, timezone: e.target.value })}
          placeholder="Europe/Paris"
        />
      </Field>
    </div>
  );
}

function EventBuilder({ trigger, onChange }: { trigger: TriggerConfig; onChange: (t: TriggerConfig) => void }) {
  return (
    <div className="space-y-3">
      <Field label="Type d'événement">
        <select
          className={selectClass()}
          style={inputStyle()}
          value={trigger.eventType ?? "entity.created"}
          onChange={(e) => onChange({ ...trigger, eventType: e.target.value })}
        >
          {EVENT_TYPES.map((et) => (
            <option key={et.value} value={et.value}>{et.label}</option>
          ))}
        </select>
      </Field>
      <Field label="Type d'entité (filtre optionnel)">
        <select
          className={selectClass()}
          style={inputStyle()}
          value={trigger.entityTypeId ?? ""}
          onChange={(e) => onChange({ ...trigger, entityTypeId: e.target.value || undefined })}
        >
          <option value="">Toutes les entités</option>
          {ENTITY_TYPES.map((et) => (
            <option key={et.value} value={et.value}>{et.label}</option>
          ))}
        </select>
      </Field>
    </div>
  );
}

function AlarmBuilder({ trigger, onChange }: { trigger: TriggerConfig; onChange: (t: TriggerConfig) => void }) {
  return (
    <div className="space-y-3">
      <Field label="Type d'entité">
        <select
          className={selectClass()}
          style={inputStyle()}
          value={trigger.entityTypeId ?? "person"}
          onChange={(e) => onChange({ ...trigger, entityTypeId: e.target.value })}
        >
          {ENTITY_TYPES.map((et) => (
            <option key={et.value} value={et.value}>{et.label}</option>
          ))}
        </select>
      </Field>
      <Field label="Champ date">
        <input
          type="text"
          className={inputClass()}
          style={inputStyle()}
          value={trigger.dateField ?? "birthday"}
          onChange={(e) => onChange({ ...trigger, dateField: e.target.value })}
          placeholder="birthday"
        />
      </Field>
      <Field label="Décalage (offset)">
        <input
          type="text"
          className={inputClass()}
          style={inputStyle()}
          value={trigger.offset ?? "-1d"}
          onChange={(e) => onChange({ ...trigger, offset: e.target.value })}
          placeholder="-1d, +2h, 0"
        />
        <p className="mt-1 text-[10px]" style={{ color: "var(--text-muted)" }}>
          Exemples : -1d (veille), +2h (2h après), 0 (même heure)
        </p>
      </Field>
      <Field label="Fuseau horaire">
        <input
          type="text"
          className={inputClass()}
          style={inputStyle()}
          value={trigger.timezone ?? "Europe/Paris"}
          onChange={(e) => onChange({ ...trigger, timezone: e.target.value })}
          placeholder="Europe/Paris"
        />
      </Field>
    </div>
  );
}

function WebhookBuilder({ trigger, onChange }: { trigger: TriggerConfig; onChange: (t: TriggerConfig) => void }) {
  return (
    <div className="space-y-3">
      <Field label="Chemin (path)">
        <input
          type="text"
          className={inputClass()}
          style={inputStyle()}
          value={trigger.path ?? "/webhook/custom"}
          onChange={(e) => onChange({ ...trigger, path: e.target.value })}
          placeholder="/webhook/custom"
        />
      </Field>
      <Field label="Méthode HTTP">
        <select
          className={selectClass()}
          style={inputStyle()}
          value={trigger.method ?? "POST"}
          onChange={(e) => onChange({ ...trigger, method: e.target.value })}
        >
          {["GET", "POST", "PUT", "PATCH"].map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
      </Field>
    </div>
  );
}

export function TriggerBuilder({ trigger, onChange }: TriggerBuilderProps) {
  function handleTypeChange(type: TriggerType) {
    const bases: Record<TriggerType, TriggerConfig> = {
      cron: { type: "cron", expression: "0 9 * * MON", timezone: "Europe/Paris" },
      event: { type: "event", eventType: "entity.created" },
      alarm: { type: "alarm", entityTypeId: "person", dateField: "birthday", offset: "-1d" },
      webhook: { type: "webhook", path: "/webhook/custom", method: "POST" },
    };
    onChange(bases[type]);
  }

  return (
    <div className="space-y-4">
      <div>
        <label className="mb-1 block text-xs font-medium" style={{ color: "var(--text-muted)" }}>
          Type de trigger
        </label>
        <div className="flex gap-2">
          {TRIGGER_TYPES.map((tt) => (
            <button
              key={tt.value}
              onClick={() => handleTypeChange(tt.value)}
              className="rounded-md border px-3 py-1.5 text-xs font-medium transition-colors"
              style={{
                borderColor: trigger.type === tt.value ? "var(--accent)" : "var(--border)",
                backgroundColor: trigger.type === tt.value ? "var(--accent-subtle)" : "transparent",
                color: trigger.type === tt.value ? "var(--accent)" : "var(--text-secondary)",
              }}
            >
              {tt.label}
            </button>
          ))}
        </div>
      </div>

      {trigger.type === "cron" && <CronBuilder trigger={trigger} onChange={onChange} />}
      {trigger.type === "event" && <EventBuilder trigger={trigger} onChange={onChange} />}
      {trigger.type === "alarm" && <AlarmBuilder trigger={trigger} onChange={onChange} />}
      {trigger.type === "webhook" && <WebhookBuilder trigger={trigger} onChange={onChange} />}
    </div>
  );
}
