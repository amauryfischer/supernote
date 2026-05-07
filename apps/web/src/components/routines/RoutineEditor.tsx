"use client";

import { useState } from "react";
import { Plus, FloppyDisk, X, Play, ArrowLeft } from "@phosphor-icons/react";
import Link from "next/link";
import type { RoutineFixture, ActionConfig, ActionType } from "./fixtures";
import { TriggerBuilder } from "./TriggerBuilder";
import { ActionCard } from "./ActionCard";
import { ActionPickerModal } from "./ActionPickerModal";
import { RunsHistoryTable } from "./RunsHistoryTable";

interface RoutineEditorProps {
  routine: RoutineFixture;
  onSave: (routine: RoutineFixture) => void;
  onCancel: () => void;
  onRunNow?: () => void;
}

type Section = "trigger" | "condition" | "actions" | "history";

function SectionHeader({
  label,
  sublabel,
  step,
}: {
  label: string;
  sublabel?: string;
  step?: string;
}) {
  return (
    <div className="mb-3 flex items-center gap-3">
      {step && (
        <div
          className="flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold"
          style={{ backgroundColor: "var(--accent)", color: "var(--accent-foreground)" }}
        >
          {step}
        </div>
      )}
      <div>
        <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
          {label}
        </h3>
        {sublabel && (
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            {sublabel}
          </p>
        )}
      </div>
    </div>
  );
}

function Connector() {
  return (
    <div className="flex items-center justify-start pl-3 py-1">
      <div
        className="h-6 w-0.5 rounded-full"
        style={{ backgroundColor: "var(--border)" }}
      />
    </div>
  );
}

export function RoutineEditor({ routine, onSave, onCancel, onRunNow }: RoutineEditorProps) {
  const [data, setData] = useState<RoutineFixture>(routine);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [activeSection, setActiveSection] = useState<Section>("trigger");
  const [saved, setSaved] = useState(false);

  function update(patch: Partial<RoutineFixture>) {
    setData((prev) => ({ ...prev, ...patch }));
    setSaved(false);
  }

  function addAction(type: ActionType) {
    const defaults: Record<ActionType, Partial<ActionConfig>> = {
      "create-mail-draft": { to: "", subject: "", body: "" },
      "create-inbox-note": { title: "", body: "", tags: [] },
      "notify-app": { title: "", body: "", level: "info" },
      "notify-os": { title: "", body: "" },
      "llm-prompt": { prompt: "", model: "llama3", storeResultAs: "" },
      webhook: { url: "", method: "POST", body: "" },
      "create-entity": { typeId: "", fields: {} },
      "update-entity": { entityId: "", patch: {} },
      "create-relation": { sourceId: "", targetId: "", relationTypeId: "" },
      "run-script": { script: "" },
    };
    const newAction: ActionConfig = { type, ...defaults[type] } as ActionConfig;
    update({ actions: [...data.actions, newAction] });
  }

  function updateAction(index: number, action: ActionConfig) {
    const actions = [...data.actions];
    actions[index] = action;
    update({ actions });
  }

  function removeAction(index: number) {
    update({ actions: data.actions.filter((_, i) => i !== index) });
  }

  function handleSave() {
    onSave(data);
    setSaved(true);
  }

  const SECTIONS: { id: Section; label: string }[] = [
    { id: "trigger", label: "Quand" },
    { id: "condition", label: "Si (condition)" },
    { id: "actions", label: "Alors (actions)" },
    { id: "history", label: "Historique" },
  ];

  return (
    <div className="flex h-full flex-col">
      {/* Top bar */}
      <div
        className="flex items-center justify-between border-b px-6 py-3"
        style={{ borderColor: "var(--border-subtle)", backgroundColor: "var(--surface-0)" }}
      >
        <div className="flex items-center gap-3">
          <Link
            href="/routines"
            className="flex items-center gap-1 rounded p-1 text-xs transition-colors hover:bg-[var(--surface-2)]"
            style={{ color: "var(--text-muted)" }}
          >
            <ArrowLeft size={14} />
            Routines
          </Link>
          <span style={{ color: "var(--border)" }}>/</span>
          <input
            type="text"
            value={data.name}
            onChange={(e) => update({ name: e.target.value })}
            className="rounded border border-transparent bg-transparent px-1 py-0.5 text-sm font-semibold outline-none focus:border-[var(--accent)] focus:bg-[var(--surface-1)]"
            style={{ color: "var(--text-primary)", minWidth: 200 }}
          />
        </div>
        <div className="flex items-center gap-2">
          {onRunNow && (
            <button
              onClick={onRunNow}
              className="flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors hover:bg-[var(--surface-2)]"
              style={{ borderColor: "var(--border)", color: "var(--text-secondary)" }}
            >
              <Play size={13} />
              Tester
            </button>
          )}
          <button
            onClick={onCancel}
            className="flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors hover:bg-[var(--surface-2)]"
            style={{ borderColor: "var(--border)", color: "var(--text-secondary)" }}
          >
            <X size={13} />
            Annuler
          </button>
          <button
            onClick={handleSave}
            className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-opacity hover:opacity-90"
            style={{ backgroundColor: "var(--accent)", color: "var(--accent-foreground)" }}
          >
            <FloppyDisk size={13} />
            {saved ? "Enregistré" : "Enregistrer"}
          </button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Section tabs */}
        <nav
          className="flex flex-col gap-0.5 border-r p-3"
          style={{ width: 160, borderColor: "var(--border-subtle)", backgroundColor: "var(--surface-1)" }}
        >
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              onClick={() => setActiveSection(s.id)}
              className="rounded-md px-3 py-2 text-left text-xs font-medium transition-colors"
              style={{
                backgroundColor: activeSection === s.id ? "var(--accent-subtle)" : "transparent",
                color: activeSection === s.id ? "var(--accent)" : "var(--text-secondary)",
              }}
            >
              {s.label}
            </button>
          ))}
        </nav>

        {/* Editor content */}
        <div className="flex-1 overflow-y-auto px-8 py-6">
          <div className="mx-auto max-w-xl">
            {/* Metadata */}
            <div className="mb-6">
              <label className="mb-1 block text-xs font-medium" style={{ color: "var(--text-muted)" }}>
                Description
              </label>
              <input
                type="text"
                value={data.description}
                onChange={(e) => update({ description: e.target.value })}
                className="w-full rounded-md border px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
                style={{
                  backgroundColor: "var(--surface-0)",
                  borderColor: "var(--border)",
                  color: "var(--text-primary)",
                }}
                placeholder="Description de la routine…"
              />
            </div>

            {/* QUAND — Trigger */}
            {activeSection === "trigger" && (
              <div
                className="rounded-xl border p-5"
                style={{ backgroundColor: "var(--surface-1)", borderColor: "var(--border-subtle)" }}
              >
                <SectionHeader
                  step="1"
                  label="Quand (Trigger)"
                  sublabel="Définit ce qui déclenche cette routine"
                />
                <TriggerBuilder
                  trigger={data.trigger}
                  onChange={(trigger) => update({ trigger })}
                />
              </div>
            )}

            {/* SI — Condition */}
            {activeSection === "condition" && (
              <>
                <div
                  className="rounded-xl border p-5"
                  style={{ backgroundColor: "var(--surface-1)", borderColor: "var(--border-subtle)" }}
                >
                  <SectionHeader
                    step="2"
                    label="Si (Condition)"
                    sublabel="Optionnel — la routine ne s'exécute que si cette condition est vraie"
                  />
                  <label className="mb-1 block text-xs font-medium" style={{ color: "var(--text-muted)" }}>
                    Formule de condition
                  </label>
                  <textarea
                    className="w-full resize-y rounded-md border px-3 py-2 font-mono text-sm outline-none focus:border-[var(--accent)]"
                    style={{
                      backgroundColor: "var(--surface-0)",
                      borderColor: "var(--border)",
                      color: "var(--text-primary)",
                    }}
                    rows={3}
                    value={data.condition ?? ""}
                    onChange={(e) => update({ condition: e.target.value || undefined })}
                    placeholder="person.lastInteraction.daysAgo > 30"
                  />
                  <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
                    Exemples : <code className="rounded px-1" style={{ backgroundColor: "var(--surface-3)" }}>entity.fields.status === &apos;active&apos;</code>{" "}
                    <code className="rounded px-1" style={{ backgroundColor: "var(--surface-3)" }}>daysAgo(now, entity.fields.lastInteraction) &gt; 30</code>
                  </p>
                </div>
              </>
            )}

            {/* ALORS — Actions */}
            {activeSection === "actions" && (
              <>
                <div
                  className="rounded-xl border p-5"
                  style={{ backgroundColor: "var(--surface-1)", borderColor: "var(--border-subtle)" }}
                >
                  <SectionHeader
                    step="3"
                    label="Alors (Actions)"
                    sublabel="Séquence d'actions exécutées dans l'ordre"
                  />

                  {data.actions.length === 0 && (
                    <p className="mb-4 text-sm" style={{ color: "var(--text-muted)" }}>
                      Aucune action. Cliquez sur &quot;+ Ajouter une action&quot; pour commencer.
                    </p>
                  )}

                  <div className="space-y-2">
                    {data.actions.map((action, i) => (
                      <div key={i}>
                        <ActionCard
                          action={action}
                          index={i}
                          onChange={(a) => updateAction(i, a)}
                          onRemove={() => removeAction(i)}
                        />
                        {i < data.actions.length - 1 && <Connector />}
                      </div>
                    ))}
                  </div>

                  <button
                    onClick={() => setPickerOpen(true)}
                    className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg border border-dashed py-3 text-sm font-medium transition-colors hover:bg-[var(--surface-2)]"
                    style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}
                  >
                    <Plus size={14} />
                    Ajouter une action
                  </button>
                </div>
              </>
            )}

            {/* HISTORY */}
            {activeSection === "history" && (
              <div
                className="rounded-xl border p-5"
                style={{ backgroundColor: "var(--surface-1)", borderColor: "var(--border-subtle)" }}
              >
                <SectionHeader label="Historique des runs" sublabel="Les 10 derniers runs de cette routine" />
                <RunsHistoryTable runs={routine.runs} />
              </div>
            )}
          </div>
        </div>
      </div>

      <ActionPickerModal
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onSelect={addAction}
      />
    </div>
  );
}
