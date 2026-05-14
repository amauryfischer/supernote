"use client";

import { Button, Input, Select, ListBox, ListBoxItem } from "@heroui/react";
import type { Key } from "@heroui/react";
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

function inputStyle() {
  return {
    backgroundColor: "var(--surface-0)",
    borderColor: "var(--border)",
    color: "var(--text-primary)",
  };
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

function SelectField({
  label,
  selectedKey,
  onSelectionChange,
  options,
  includeEmpty,
}: {
  label: string;
  selectedKey: string;
  onSelectionChange: (key: Key | null) => void;
  options: Array<{ value: string; label: string }>;
  includeEmpty?: { label: string };
}) {
  return (
    <Field label={label}>
      <Select
        selectedKey={selectedKey}
        onSelectionChange={onSelectionChange}
        aria-label={label}
      >
        <Select.Trigger
          className="flex w-full items-center justify-between rounded border px-2.5 py-1.5 text-sm outline-none transition-colors"
          style={inputStyle()}
        >
          <Select.Value />
        </Select.Trigger>
        <Select.Popover>
          <ListBox>
            {includeEmpty && (
              <ListBoxItem key="">{includeEmpty.label}</ListBoxItem>
            )}
            {options.map((opt) => (
              <ListBoxItem key={opt.value}>{opt.label}</ListBoxItem>
            ))}
          </ListBox>
        </Select.Popover>
      </Select>
    </Field>
  );
}

function CronBuilder({ trigger, onChange }: { trigger: TriggerConfig; onChange: (t: TriggerConfig) => void }) {
  const expr = trigger.expression ?? "0 9 * * MON";
  const preset = CRON_PRESETS.find((p) => p.value === expr);
  const isCustom = !preset || preset.value === "custom";

  function handlePreset(key: Key | null) {
    const value = String(key ?? "");
    if (value === "custom" || !value) return;
    onChange({ ...trigger, expression: value });
  }

  return (
    <div className="space-y-3">
      <SelectField
        label="Fréquence"
        selectedKey={isCustom ? "custom" : expr}
        onSelectionChange={handlePreset}
        options={CRON_PRESETS}
      />
      <Field label="Expression cron">
        <Input
          value={expr}
          onChange={(e) => onChange({ ...trigger, expression: e.target.value })}
          placeholder="0 9 * * MON"
          spellCheck={false}
          className="w-full rounded-md border px-3 py-2 font-mono text-sm outline-none focus:border-[var(--accent)] transition-colors"
          style={inputStyle()}
        />
        <p className="mt-1 text-[10px]" style={{ color: "var(--text-muted)" }}>
          Format : minute heure jour mois jour_semaine — ex : 0 9 * * MON
        </p>
      </Field>
      <Field label="Fuseau horaire">
        <Input
          value={trigger.timezone ?? "Europe/Paris"}
          onChange={(e) => onChange({ ...trigger, timezone: e.target.value })}
          placeholder="Europe/Paris"
          className="w-full rounded-md border px-3 py-2 text-sm outline-none focus:border-[var(--accent)] transition-colors"
          style={inputStyle()}
        />
      </Field>
    </div>
  );
}

function EventBuilder({ trigger, onChange }: { trigger: TriggerConfig; onChange: (t: TriggerConfig) => void }) {
  return (
    <div className="space-y-3">
      <SelectField
        label="Type d'événement"
        selectedKey={trigger.eventType ?? "entity.created"}
        onSelectionChange={(k) => onChange({ ...trigger, eventType: String(k ?? "") })}
        options={EVENT_TYPES}
      />
      <SelectField
        label="Type d'entité (filtre optionnel)"
        selectedKey={trigger.entityTypeId ?? ""}
        onSelectionChange={(k) => onChange({ ...trigger, entityTypeId: String(k ?? "") || undefined })}
        options={ENTITY_TYPES}
        includeEmpty={{ label: "Toutes les entités" }}
      />
    </div>
  );
}

function AlarmBuilder({ trigger, onChange }: { trigger: TriggerConfig; onChange: (t: TriggerConfig) => void }) {
  return (
    <div className="space-y-3">
      <SelectField
        label="Type d'entité"
        selectedKey={trigger.entityTypeId ?? "person"}
        onSelectionChange={(k) => onChange({ ...trigger, entityTypeId: String(k ?? "") })}
        options={ENTITY_TYPES}
      />
      <Field label="Champ date">
        <Input
          value={trigger.dateField ?? "birthday"}
          onChange={(e) => onChange({ ...trigger, dateField: e.target.value })}
          placeholder="birthday"
          className="w-full rounded-md border px-3 py-2 text-sm outline-none focus:border-[var(--accent)] transition-colors"
          style={inputStyle()}
        />
      </Field>
      <Field label="Décalage (offset)">
        <Input
          value={trigger.offset ?? "-1d"}
          onChange={(e) => onChange({ ...trigger, offset: e.target.value })}
          placeholder="-1d, +2h, 0"
          className="w-full rounded-md border px-3 py-2 text-sm outline-none focus:border-[var(--accent)] transition-colors"
          style={inputStyle()}
        />
        <p className="mt-1 text-[10px]" style={{ color: "var(--text-muted)" }}>
          Exemples : -1d (veille), +2h (2h après), 0 (même heure)
        </p>
      </Field>
      <Field label="Fuseau horaire">
        <Input
          value={trigger.timezone ?? "Europe/Paris"}
          onChange={(e) => onChange({ ...trigger, timezone: e.target.value })}
          placeholder="Europe/Paris"
          className="w-full rounded-md border px-3 py-2 text-sm outline-none focus:border-[var(--accent)] transition-colors"
          style={inputStyle()}
        />
      </Field>
    </div>
  );
}

function WebhookBuilder({ trigger, onChange }: { trigger: TriggerConfig; onChange: (t: TriggerConfig) => void }) {
  return (
    <div className="space-y-3">
      <Field label="Chemin (path)">
        <Input
          value={trigger.path ?? "/webhook/custom"}
          onChange={(e) => onChange({ ...trigger, path: e.target.value })}
          placeholder="/webhook/custom"
          className="w-full rounded-md border px-3 py-2 text-sm outline-none focus:border-[var(--accent)] transition-colors"
          style={inputStyle()}
        />
      </Field>
      <SelectField
        label="Méthode HTTP"
        selectedKey={trigger.method ?? "POST"}
        onSelectionChange={(k) => onChange({ ...trigger, method: String(k ?? "") })}
        options={["GET", "POST", "PUT", "PATCH"].map((m) => ({ value: m, label: m }))}
      />
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
            <Button
              key={tt.value}
              variant="ghost"
              size="sm"
              onPress={() => handleTypeChange(tt.value)}
              className="rounded-md border px-3 py-1.5 text-xs font-medium transition-colors"
              style={{
                borderColor: trigger.type === tt.value ? "var(--accent)" : "var(--border)",
                backgroundColor: trigger.type === tt.value ? "var(--accent-subtle)" : "transparent",
                color: trigger.type === tt.value ? "var(--accent)" : "var(--text-secondary)",
              }}
            >
              {tt.label}
            </Button>
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
