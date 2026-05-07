"use client";

import { Trash, DotsSixVertical } from "@phosphor-icons/react";
import type { ActionConfig, ActionType } from "./fixtures";

interface ActionCardProps {
  action: ActionConfig;
  index: number;
  onChange: (action: ActionConfig) => void;
  onRemove: () => void;
}

const ACTION_LABELS: Record<ActionType, string> = {
  "create-mail-draft": "Brouillon email",
  "create-entity": "Créer entité",
  "update-entity": "Modifier entité",
  "create-relation": "Créer relation",
  "notify-os": "Notification OS",
  "notify-app": "Notification app",
  webhook: "Webhook HTTP",
  "llm-prompt": "Prompt IA",
  "run-script": "Script",
  "create-inbox-note": "Note inbox",
};

function inputStyle() {
  return { backgroundColor: "var(--surface-0)", borderColor: "var(--border)", color: "var(--text-primary)" };
}

function inputClass() {
  return "w-full rounded border px-2.5 py-1.5 text-sm outline-none focus:border-[var(--accent)] transition-colors";
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-0.5 block text-[10px] font-medium" style={{ color: "var(--text-muted)" }}>
        {label}
      </label>
      {children}
    </div>
  );
}

function MailDraftForm({ action, onChange }: { action: ActionConfig; onChange: (a: ActionConfig) => void }) {
  function set(key: string, value: string) {
    onChange({ ...action, [key]: value });
  }
  return (
    <div className="space-y-2">
      <Field label="À (to)">
        <input className={inputClass()} style={inputStyle()} value={String(action.to ?? "")} onChange={(e) => set("to", e.target.value)} placeholder="contact@exemple.fr ou {{entity.fields.email}}" />
      </Field>
      <Field label="Objet">
        <input className={inputClass()} style={inputStyle()} value={String(action.subject ?? "")} onChange={(e) => set("subject", e.target.value)} placeholder="Objet — {{now}}" />
      </Field>
      <Field label="Corps du message">
        <textarea className={`${inputClass()} resize-y`} style={inputStyle()} rows={4} value={String(action.body ?? "")} onChange={(e) => set("body", e.target.value)} placeholder="Corps du message…" />
        <p className="mt-0.5 text-[10px]" style={{ color: "var(--text-muted)" }}>Variables : {"{{now}}"}, {"{{entity.fields.name}}"}, {"{{entity.fields.email}}"}</p>
      </Field>
    </div>
  );
}

function NotifyForm({ action, onChange, hasLevel }: { action: ActionConfig; onChange: (a: ActionConfig) => void; hasLevel?: boolean }) {
  function set(key: string, value: string) {
    onChange({ ...action, [key]: value });
  }
  return (
    <div className="space-y-2">
      <Field label="Titre">
        <input className={inputClass()} style={inputStyle()} value={String(action.title ?? "")} onChange={(e) => set("title", e.target.value)} placeholder="Titre de la notification" />
      </Field>
      <Field label="Message">
        <textarea className={`${inputClass()} resize-y`} style={inputStyle()} rows={2} value={String(action.body ?? "")} onChange={(e) => set("body", e.target.value)} placeholder="Message…" />
      </Field>
      {hasLevel && (
        <Field label="Niveau">
          <select className={`${inputClass()} cursor-pointer`} style={inputStyle()} value={String(action.level ?? "info")} onChange={(e) => set("level", e.target.value)}>
            <option value="info">Info</option>
            <option value="warning">Avertissement</option>
            <option value="error">Erreur</option>
          </select>
        </Field>
      )}
    </div>
  );
}

function LlmPromptForm({ action, onChange }: { action: ActionConfig; onChange: (a: ActionConfig) => void }) {
  function set(key: string, value: string) {
    onChange({ ...action, [key]: value });
  }
  return (
    <div className="space-y-2">
      <Field label="Modèle">
        <input className={inputClass()} style={inputStyle()} value={String(action.model ?? "llama3")} onChange={(e) => set("model", e.target.value)} placeholder="llama3, gpt-4o…" />
      </Field>
      <Field label="Prompt">
        <textarea className={`${inputClass()} resize-y font-mono text-xs`} style={inputStyle()} rows={5} value={String(action.prompt ?? "")} onChange={(e) => set("prompt", e.target.value)} placeholder="Écris un résumé de…" />
      </Field>
      <Field label="Stocker le résultat dans">
        <input className={inputClass()} style={inputStyle()} value={String(action.storeResultAs ?? "")} onChange={(e) => set("storeResultAs", e.target.value)} placeholder="dailyBrief" />
      </Field>
    </div>
  );
}

function WebhookForm({ action, onChange }: { action: ActionConfig; onChange: (a: ActionConfig) => void }) {
  function set(key: string, value: string) {
    onChange({ ...action, [key]: value });
  }
  return (
    <div className="space-y-2">
      <Field label="URL">
        <input className={inputClass()} style={inputStyle()} value={String(action.url ?? "")} onChange={(e) => set("url", e.target.value)} placeholder="https://hooks.example.com/endpoint" />
      </Field>
      <Field label="Méthode">
        <select className={`${inputClass()} cursor-pointer`} style={inputStyle()} value={String(action.method ?? "POST")} onChange={(e) => set("method", e.target.value)}>
          {["GET", "POST", "PUT", "PATCH"].map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
      </Field>
      <Field label="Corps (JSON)">
        <textarea className={`${inputClass()} resize-y font-mono text-xs`} style={inputStyle()} rows={3} value={String(action.body ?? "")} onChange={(e) => set("body", e.target.value)} placeholder='{"key": "{{entity.id}}"}' />
      </Field>
    </div>
  );
}

function InboxNoteForm({ action, onChange }: { action: ActionConfig; onChange: (a: ActionConfig) => void }) {
  function set(key: string, value: string) {
    onChange({ ...action, [key]: value });
  }
  return (
    <div className="space-y-2">
      <Field label="Titre">
        <input className={inputClass()} style={inputStyle()} value={String(action.title ?? "")} onChange={(e) => set("title", e.target.value)} placeholder="Titre de la note" />
      </Field>
      <Field label="Corps">
        <textarea className={`${inputClass()} resize-y`} style={inputStyle()} rows={3} value={String(action.body ?? "")} onChange={(e) => set("body", e.target.value)} placeholder="Contenu de la note…" />
      </Field>
    </div>
  );
}

function CreateEntityForm({ action, onChange }: { action: ActionConfig; onChange: (a: ActionConfig) => void }) {
  function set(key: string, value: string) {
    onChange({ ...action, [key]: value });
  }
  return (
    <div className="space-y-2">
      <Field label="Type d'entité (typeId)">
        <input className={inputClass()} style={inputStyle()} value={String(action.typeId ?? "")} onChange={(e) => set("typeId", e.target.value)} placeholder="person, note, task…" />
      </Field>
      <Field label="Champs (key=value, un par ligne)">
        <textarea
          className={`${inputClass()} resize-y font-mono text-xs`}
          style={inputStyle()}
          rows={4}
          value={Object.entries((action.fields as Record<string, string>) ?? {}).map(([k, v]) => `${k}=${v}`).join("\n")}
          onChange={(e) => {
            const fields = Object.fromEntries(
              e.target.value.split("\n").filter(Boolean).map((l) => {
                const eq = l.indexOf("=");
                return [l.slice(0, eq).trim(), l.slice(eq + 1).trim()];
              })
            );
            onChange({ ...action, fields });
          }}
          placeholder={"name={{entity.fields.name}}\nstatus=new"}
        />
      </Field>
    </div>
  );
}

function RunScriptForm({ action, onChange }: { action: ActionConfig; onChange: (a: ActionConfig) => void }) {
  function set(key: string, value: string) {
    onChange({ ...action, [key]: value });
  }
  return (
    <div className="space-y-2">
      <Field label="Script (JavaScript)">
        <textarea
          className={`${inputClass()} resize-y font-mono text-xs`}
          style={inputStyle()}
          rows={8}
          value={String(action.script ?? "")}
          onChange={(e) => set("script", e.target.value)}
          placeholder={"// context: entity, now, env\nconsole.log('Hello', entity.id);"}
        />
      </Field>
    </div>
  );
}

function ActionForm({ action, onChange }: { action: ActionConfig; onChange: (a: ActionConfig) => void }) {
  switch (action.type) {
    case "create-mail-draft": return <MailDraftForm action={action} onChange={onChange} />;
    case "notify-os": return <NotifyForm action={action} onChange={onChange} />;
    case "notify-app": return <NotifyForm action={action} onChange={onChange} hasLevel />;
    case "llm-prompt": return <LlmPromptForm action={action} onChange={onChange} />;
    case "webhook": return <WebhookForm action={action} onChange={onChange} />;
    case "create-inbox-note": return <InboxNoteForm action={action} onChange={onChange} />;
    case "create-entity": return <CreateEntityForm action={action} onChange={onChange} />;
    case "run-script": return <RunScriptForm action={action} onChange={onChange} />;
    default:
      return (
        <p className="text-xs" style={{ color: "var(--text-muted)" }}>
          Configuration de type &quot;{action.type}&quot; non encore supportée dans l&apos;éditeur.
        </p>
      );
  }
}

export function ActionCard({ action, index, onChange, onRemove }: ActionCardProps) {
  return (
    <div
      className="rounded-lg border"
      style={{ backgroundColor: "var(--surface-1)", borderColor: "var(--border-subtle)" }}
    >
      {/* Header */}
      <div
        className="flex items-center gap-2 rounded-t-lg border-b px-3 py-2"
        style={{ borderColor: "var(--border-subtle)", backgroundColor: "var(--surface-2)" }}
      >
        <DotsSixVertical size={14} style={{ color: "var(--text-muted)", cursor: "grab" }} />
        <span
          className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full text-[10px] font-bold"
          style={{ backgroundColor: "var(--accent)", color: "var(--accent-foreground)" }}
        >
          {index + 1}
        </span>
        <span className="flex-1 text-xs font-semibold" style={{ color: "var(--text-primary)" }}>
          {ACTION_LABELS[action.type] ?? action.type}
        </span>
        <button
          onClick={onRemove}
          className="rounded p-0.5 transition-colors hover:bg-[oklch(0.93_0.10_28_/_0.15)]"
          style={{ color: "var(--danger)" }}
          aria-label="Supprimer l'action"
        >
          <Trash size={13} />
        </button>
      </div>

      {/* Form */}
      <div className="p-3">
        <ActionForm action={action} onChange={onChange} />
      </div>
    </div>
  );
}
