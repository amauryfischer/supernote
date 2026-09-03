"use client";

import { useState } from "react";
import { Button, Input, TextArea, Checkbox, Select, ListBox, ListBoxItem } from "@heroui/react";
import type { Key } from "@heroui/react";
import { X, Plus, Trash } from "@phosphor-icons/react";
import type { Field, FieldKind, SelectOption } from "@supernote/core";
import { FIELD_KINDS, ENTITY_TYPES } from "./fixtures";

interface FieldEditorModalProps {
  field: Field | null;
  onClose: () => void;
  onSave: (field: Field) => void;
}

// ---- Client-side validation for the field definition ----
function validateFieldDef(
  label: string,
  name: string,
  kind: FieldKind,
  options: SelectOption[],
): string | null {
  if (!label.trim()) return "Le label est requis";
  if (!name.trim()) return "Le slug est requis";
  if (kind === "select" || kind === "multiselect" || kind === "status") {
    if (options.length === 0) return "Au moins une option est requise";
    for (const opt of options) {
      if (!opt.value.trim() || !opt.label.trim()) return "Chaque option doit avoir un label";
    }
  }
  return null;
}

// ---- Helpers ----
function makeSlug(s: string) {
  return s.toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "");
}

function newFieldId() {
  return `field_${Math.random().toString(36).slice(2, 8)}`;
}

const KIND_GROUPS = Array.from(new Set(FIELD_KINDS.map((k) => k.group)));

export function FieldEditorModal({ field, onClose, onSave }: FieldEditorModalProps) {
  const [label, setLabel] = useState(field?.label ?? "");
  const [name, setName] = useState(field?.name ?? "");
  const [kind, setKind] = useState<FieldKind>(field?.kind ?? "text");
  const [required, setRequired] = useState(field?.required ?? false);
  const [unique, setUnique] = useState(field?.unique ?? false);
  const [helpText, setHelpText] = useState(field?.helpText ?? "");
  const [options, setOptions] = useState<SelectOption[]>(
    (field as { options?: SelectOption[] })?.options ?? []
  );
  const [expression, setExpression] = useState(
    (field as { expression?: string })?.expression ?? ""
  );
  const [targetTypeId, setTargetTypeId] = useState(
    (field as { targetTypeId?: string })?.targetTypeId ?? ""
  );
  const [cardinality, setCardinality] = useState(
    (field as { cardinality?: string })?.cardinality ?? "many_to_many"
  );
  const [validationError, setValidationError] = useState<string | null>(null);

  const handleLabelChange = (v: string) => {
    setLabel(v);
    if (!field) setName(makeSlug(v));
  };

  const handleSave = () => {
    setValidationError(null);
    const error = validateFieldDef(label, name, kind, options);
    if (error) {
      setValidationError(error);
      return;
    }

    // Preserve every config prop the modal doesn't edit (outputKind, min/max,
    // precision, currencyCode, format, defaultValue, relationFieldId,
    // targetFieldId, aggregation…). Re-saving a configured field must not wipe it.
    const prev = (field ?? {}) as Record<string, unknown>;
    const base = {
      ...prev,
      id: field?.id ?? newFieldId(),
      name,
      label,
      required,
      unique,
      helpText,
      kind,
    };
    let extra: Record<string, unknown> = {};
    if (kind === "select" || kind === "multiselect" || kind === "status") {
      extra = { options };
    } else if (kind === "formula") {
      extra = { expression, outputKind: prev.outputKind ?? "text" };
    } else if (kind === "relation") {
      extra = { targetTypeId, cardinality };
    } else if (kind === "rollup" || kind === "lookup") {
      extra = {
        relationFieldId: prev.relationFieldId ?? "",
        targetFieldId: prev.targetFieldId ?? "",
      };
      if (kind === "rollup") extra.aggregation = prev.aggregation ?? "count";
    }
    onSave({ ...base, ...extra } as Field);
  };

  const addOption = () => {
    setOptions([
      ...options,
      { value: makeSlug(label + String(options.length)), label: "Nouvelle option", color: "#64748B" },
    ]);
  };

  const removeOption = (i: number) => setOptions(options.filter((_, idx) => idx !== i));

  const updateOption = (i: number, patch: Partial<SelectOption>) => {
    setOptions(options.map((o, idx) => (idx === i ? { ...o, ...patch } : o)));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
      <div
        className="flex w-full max-w-lg flex-col rounded-2xl border shadow-2xl"
        style={{ backgroundColor: "var(--surface-0)", borderColor: "var(--border)" }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between border-b px-6 py-4"
          style={{ borderColor: "var(--border-subtle)" }}
        >
          <h2 className="text-base font-semibold" style={{ color: "var(--text-primary)" }}>
            {field ? "Modifier le champ" : "Nouveau champ"}
          </h2>
          <Button isIconOnly variant="ghost" size="sm" onPress={onClose} aria-label="Fermer" className="rounded-md p-1 hover:bg-[var(--surface-2)]">
            <X size={16} style={{ color: "var(--text-muted)" }} />
          </Button>
        </div>

        <div className="flex flex-col gap-4 overflow-y-auto p-6">
          {/* Label / Name */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
                Label
              </label>
              <Input
                value={label}
                onChange={(e) => handleLabelChange(e.target.value)}
                className="w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[var(--accent)]"
                style={{ borderColor: "var(--border)", backgroundColor: "var(--surface-1)", color: "var(--text-primary)" }}
                placeholder="Mon champ"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
                Slug (name)
              </label>
              <Input
                value={name}
                onChange={(e) => setName(makeSlug(e.target.value))}
                className="w-full rounded-lg border px-3 py-2 font-mono text-sm outline-none focus:ring-2 focus:ring-[var(--accent)]"
                style={{ borderColor: "var(--border)", backgroundColor: "var(--surface-1)", color: "var(--text-primary)" }}
              />
            </div>
          </div>

          {/* Kind */}
          <div>
            <label className="mb-2 block text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
              Type de champ
            </label>
            <div className="flex flex-col gap-3">
              {KIND_GROUPS.map((group) => (
                <div key={group}>
                  <p
                    className="sn-eyebrow sn-eyebrow--compact mb-1"
                  >
                    {group}
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {FIELD_KINDS.filter((k) => k.group === group).map((k) => (
                      <Button
                        key={k.kind}
                        variant="ghost"
                        size="sm"
                        onPress={() => setKind(k.kind as FieldKind)}
                        className="rounded-md border px-2.5 py-1 text-xs font-medium transition-colors"
                        style={
                          kind === k.kind
                            ? {
                                backgroundColor: "var(--btn-primary-bg)",
                                color: "var(--btn-primary-fg)",
                                borderColor: "var(--accent)",
                              }
                            : { borderColor: "var(--border)", color: "var(--text-secondary)" }
                        }
                      >
                        {k.label}
                      </Button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Select options */}
          {(kind === "select" || kind === "multiselect" || kind === "status") && (
            <div>
              <div className="mb-2 flex items-center justify-between">
                <label className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
                  Options
                </label>
                <Button variant="ghost" size="sm" onPress={addOption} className="flex items-center gap-1 text-xs" style={{ color: "var(--accent)" }}>
                  <Plus size={11} /> Ajouter
                </Button>
              </div>
              <div className="flex flex-col gap-1.5">
                {options.map((opt, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <input
                      type="color"
                      value={opt.color ?? "#64748B"}
                      onChange={(e) => updateOption(i, { color: e.target.value })}
                      className="h-7 w-7 cursor-pointer rounded border-none"
                    />
                    <Input
                      value={opt.label}
                      onChange={(e) =>
                        updateOption(i, { label: e.target.value, value: makeSlug(e.target.value) })
                      }
                      className="flex-1 rounded-lg border px-3 py-1.5 text-sm outline-none"
                      style={{
                        borderColor: "var(--border)",
                        backgroundColor: "var(--surface-1)",
                        color: "var(--text-primary)",
                      }}
                    />
                    <Button isIconOnly variant="ghost" size="sm" onPress={() => removeOption(i)} aria-label="Supprimer l'option" className="rounded p-1 hover:bg-red-50">
                      <Trash size={12} style={{ color: "var(--danger)" }} />
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Relation config */}
          {kind === "relation" && (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="mb-1 block text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
                  Type cible
                </label>
                <Select
                  selectedKey={targetTypeId}
                  onSelectionChange={(k: Key | null) => setTargetTypeId(String(k ?? ""))}
                  aria-label="Type cible"
                >
                  <Select.Trigger
                    className="flex w-full items-center justify-between rounded-lg border px-3 py-2 text-sm outline-none"
                    style={{ borderColor: "var(--border)", backgroundColor: "var(--surface-1)", color: "var(--text-primary)" }}
                  >
                    <Select.Value />
                  </Select.Trigger>
                  <Select.Popover>
                    <ListBox>
                      <ListBoxItem key="">Choisir…</ListBoxItem>
                      {ENTITY_TYPES.map((t) => (
                        <ListBoxItem key={t.id}>{t.name}</ListBoxItem>
                      ))}
                    </ListBox>
                  </Select.Popover>
                </Select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
                  Cardinalité
                </label>
                <Select
                  selectedKey={cardinality}
                  onSelectionChange={(k: Key | null) => setCardinality(String(k ?? ""))}
                  aria-label="Cardinalité"
                >
                  <Select.Trigger
                    className="flex w-full items-center justify-between rounded-lg border px-3 py-2 text-sm outline-none"
                    style={{ borderColor: "var(--border)", backgroundColor: "var(--surface-1)", color: "var(--text-primary)" }}
                  >
                    <Select.Value />
                  </Select.Trigger>
                  <Select.Popover>
                    <ListBox>
                      <ListBoxItem key="one_to_one">1:1</ListBoxItem>
                      <ListBoxItem key="one_to_many">1:N</ListBoxItem>
                      <ListBoxItem key="many_to_many">N:N</ListBoxItem>
                    </ListBox>
                  </Select.Popover>
                </Select>
              </div>
            </div>
          )}

          {/* Formula */}
          {kind === "formula" && (
            <div>
              <label className="mb-1 block text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
                Expression
              </label>
              <TextArea
                value={expression}
                onChange={(e) => setExpression(e.target.value)}
                rows={3}
                className="w-full rounded-lg border px-3 py-2 font-mono text-sm outline-none"
                style={{
                  borderColor: "var(--border)",
                  backgroundColor: "var(--surface-1)",
                  color: "var(--text-primary)",
                }}
                placeholder={`if(status == "done", 100, progress)`}
              />
            </div>
          )}

          {/* Help text */}
          <div>
            <label className="mb-1 block text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
              Texte d&apos;aide
            </label>
            <Input
              value={helpText}
              onChange={(e) => setHelpText(e.target.value)}
              className="w-full rounded-lg border px-3 py-2 text-sm outline-none"
              style={{
                borderColor: "var(--border)",
                backgroundColor: "var(--surface-1)",
                color: "var(--text-primary)",
              }}
              placeholder="Optionnel"
            />
          </div>

          {/* Checkboxes */}
          <div className="flex gap-6">
            <Checkbox
              isSelected={required}
              onChange={setRequired}
              style={{ color: "var(--text-secondary)" }}
            >
              <span className="text-sm">Requis</span>
            </Checkbox>
            <Checkbox
              isSelected={unique}
              onChange={setUnique}
              style={{ color: "var(--text-secondary)" }}
            >
              <span className="text-sm">Unique</span>
            </Checkbox>
          </div>

          {/* Validation error */}
          {validationError && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
              {validationError}
            </p>
          )}
        </div>

        {/* Footer */}
        <div
          className="flex justify-end gap-2 border-t px-6 py-4"
          style={{ borderColor: "var(--border-subtle)" }}
        >
          <Button
            variant="ghost"
            size="sm"
            onPress={onClose}
            className="rounded-lg border px-4 py-2 text-sm font-medium transition-colors hover:bg-[var(--surface-2)]"
            style={{ borderColor: "var(--border)", color: "var(--text-secondary)" }}
          >
            Annuler
          </Button>
          <Button
            size="sm"
            onPress={handleSave}
            className="rounded-lg px-4 py-2 text-sm font-medium transition-colors"
            style={{ backgroundColor: "var(--btn-primary-bg)", color: "var(--btn-primary-fg)" }}
          >
            Enregistrer
          </Button>
        </div>
      </div>
    </div>
  );
}
