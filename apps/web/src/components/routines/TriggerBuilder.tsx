"use client";

import { useState } from "react";
import { Button, Input, Select, ListBox, ListBoxItem } from "@heroui/react";
import type { Key } from "@heroui/react";
import { CaretDown } from "@phosphor-icons/react";
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

interface CronPreset {
  label: string;
  value: string;
  group: "rapide" | "horaire" | "quotidien" | "hebdo" | "mensuel" | "annuel" | "custom";
}

const CRON_PRESETS: CronPreset[] = [
  // Rapide — utiles pour tests + monitoring
  { group: "rapide", label: "Toutes les minutes", value: "* * * * *" },
  { group: "rapide", label: "Toutes les 5 minutes", value: "*/5 * * * *" },
  { group: "rapide", label: "Toutes les 15 minutes", value: "*/15 * * * *" },
  { group: "rapide", label: "Toutes les 30 minutes", value: "*/30 * * * *" },

  // Horaire
  { group: "horaire", label: "Toutes les heures", value: "0 * * * *" },
  { group: "horaire", label: "Toutes les 2 heures", value: "0 */2 * * *" },
  { group: "horaire", label: "Toutes les 6 heures", value: "0 */6 * * *" },
  { group: "horaire", label: "Toutes les 12 heures", value: "0 */12 * * *" },

  // Quotidien
  { group: "quotidien", label: "Chaque jour à 7h", value: "0 7 * * *" },
  { group: "quotidien", label: "Chaque jour à 8h", value: "0 8 * * *" },
  { group: "quotidien", label: "Chaque jour à 9h", value: "0 9 * * *" },
  { group: "quotidien", label: "Chaque jour à 12h", value: "0 12 * * *" },
  { group: "quotidien", label: "Chaque jour à 18h", value: "0 18 * * *" },
  { group: "quotidien", label: "Chaque jour à 21h", value: "0 21 * * *" },
  { group: "quotidien", label: "Jours ouvrés à 9h", value: "0 9 * * MON-FRI" },
  { group: "quotidien", label: "Week-end à 10h", value: "0 10 * * SAT,SUN" },

  // Hebdo
  { group: "hebdo", label: "Chaque lundi à 8h", value: "0 8 * * MON" },
  { group: "hebdo", label: "Chaque lundi à 9h", value: "0 9 * * MON" },
  { group: "hebdo", label: "Chaque vendredi à 17h", value: "0 17 * * FRI" },
  { group: "hebdo", label: "Chaque dimanche à 20h", value: "0 20 * * SUN" },

  // Mensuel
  { group: "mensuel", label: "1er du mois à 9h", value: "0 9 1 * *" },
  { group: "mensuel", label: "15 du mois à 9h", value: "0 9 15 * *" },
  { group: "mensuel", label: "Dernier jour du mois à 18h", value: "0 18 L * *" },
  { group: "mensuel", label: "Premier lundi du mois à 9h", value: "0 9 * * MON#1" },

  // Annuel
  { group: "annuel", label: "1er janvier à 9h", value: "0 9 1 1 *" },
  { group: "annuel", label: "1er septembre à 9h (rentrée)", value: "0 9 1 9 *" },

  // Custom escape hatch
  { group: "custom", label: "Personnalisé…", value: "custom" },
];

const GROUP_LABELS: Record<CronPreset["group"], string> = {
  rapide: "Rapide",
  horaire: "Heure",
  quotidien: "Quotidien",
  hebdo: "Hebdomadaire",
  mensuel: "Mensuel",
  annuel: "Annuel",
  custom: "Avancé",
};

const GROUP_ORDER: Array<CronPreset["group"]> = [
  "rapide",
  "horaire",
  "quotidien",
  "hebdo",
  "mensuel",
  "annuel",
  "custom",
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

// Quick-pick chips shown above the disclosure. These cover the 80 % case so
// the user rarely needs to expand the full grouped preset library.
const QUICK_PICKS: CronPreset[] = [
  { group: "horaire", label: "Chaque heure", value: "0 * * * *" },
  { group: "quotidien", label: "Chaque jour 9h", value: "0 9 * * *" },
  { group: "hebdo", label: "Chaque lundi 9h", value: "0 9 * * MON" },
  { group: "mensuel", label: "1er du mois 9h", value: "0 9 1 * *" },
];

function CronBuilder({ trigger, onChange }: { trigger: TriggerConfig; onChange: (t: TriggerConfig) => void }) {
  const expr = trigger.expression ?? "0 9 * * MON";
  const matched = CRON_PRESETS.find((p) => p.value === expr && p.group !== "custom");
  const [moreOpen, setMoreOpen] = useState(false);

  function applyPreset(value: string) {
    onChange({ ...trigger, expression: value });
  }

  const byGroup = GROUP_ORDER.map((g) => ({
    group: g,
    items: CRON_PRESETS.filter((p) => p.group === g && p.group !== "custom"),
  })).filter((b) => b.items.length > 0);

  return (
    <div className="space-y-3">
      <Field label="Fréquence — choix rapide">
        <div className="flex flex-wrap gap-1.5">
          {QUICK_PICKS.map((p) => {
            const active = p.value === expr;
            return (
              <Button
                key={p.value}
                size="sm"
                variant="ghost"
                onPress={() => applyPreset(p.value)}
                className="rounded-md border px-2.5 py-1 text-xs font-medium transition-colors"
                style={{
                  borderColor: active ? "var(--accent)" : "var(--border)",
                  backgroundColor: active ? "var(--accent-subtle)" : "transparent",
                  color: active ? "var(--accent)" : "var(--text-secondary)",
                }}
              >
                {p.label}
              </Button>
            );
          })}
          <Button
            size="sm"
            variant="ghost"
            onPress={() => setMoreOpen((o) => !o)}
            className="flex items-center gap-1 rounded-md border border-dashed px-2.5 py-1 text-xs font-medium transition-colors"
            style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}
          >
            {moreOpen ? "Moins de presets" : "Plus de presets…"}
            <CaretDown size={10} className={`transition-transform ${moreOpen ? "rotate-180" : ""}`} />
          </Button>
        </div>
        {matched && !QUICK_PICKS.some((q) => q.value === expr) && (
          <p className="mt-2 text-[10px]" style={{ color: "var(--text-muted)" }}>
            Preset actif : <span style={{ color: "var(--accent)" }}>{matched.label}</span>
          </p>
        )}
      </Field>

      {moreOpen && (
        <div
          className="space-y-3 rounded-lg border p-3"
          style={{ backgroundColor: "var(--surface-1)", borderColor: "var(--border-subtle)" }}
        >
          {byGroup.map(({ group, items }) => (
            <div key={group}>
              <div
                className="sn-eyebrow sn-eyebrow--compact mb-1.5"
              >
                {GROUP_LABELS[group]}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {items.map((p) => {
                  const active = p.value === expr;
                  return (
                    <Button
                      key={p.value}
                      size="sm"
                      variant="ghost"
                      onPress={() => applyPreset(p.value)}
                      className="rounded-md border px-2.5 py-1 text-xs transition-colors"
                      style={{
                        borderColor: active ? "var(--accent)" : "var(--border)",
                        backgroundColor: active ? "var(--accent-subtle)" : "var(--surface-0)",
                        color: active ? "var(--accent)" : "var(--text-secondary)",
                      }}
                    >
                      {p.label}
                    </Button>
                  );
                })}
              </div>
            </div>
          ))}
          <p className="text-[10px] italic" style={{ color: "var(--text-muted)" }}>
            Astuce — "Toutes les minutes" est utile pour tester une routine ; ne
            la laisse pas active en prod (la PWA tournera l'engine sans pause).
          </p>
        </div>
      )}

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
          Format : minute heure jour mois jour_semaine — ex : 0 9 * * MON.
          Caractères : <code>*</code> (tous), <code>*/n</code> (tous les n),
          {" "}<code>n-m</code> (plage), <code>a,b,c</code> (liste),
          {" "}<code>MON-FRI</code> (semaine), <code>L</code> (dernier jour),
          {" "}<code>MON#1</code> (1er lundi du mois).
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
