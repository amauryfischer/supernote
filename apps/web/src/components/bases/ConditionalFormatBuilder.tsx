"use client";

/**
 * ConditionalFormatBuilder — éditeur de règles de mise en forme conditionnelle
 * pour une vue. Persiste dans `view.conditionalFormats`.
 *
 * Une règle = { fieldId, op, value, style: { bg, fg, bold, italic }, scope }.
 * `scope=cell` colore uniquement la colonne ciblée, `scope=row` colore toute
 * la ligne dès qu'elle matche.
 */

import { useState } from "react";
import { Button } from "@heroui/react";
import { Plus, Trash } from "@phosphor-icons/react";
import type { EntityType, Field } from "@supernote/core";
import type {
  ConditionalFormatRule,
  FilterOp,
  View,
} from "@supernote/ipc";
import { NativeSelect } from "@/components/settings/NativeSelect";
import { useViewMutations } from "./hooks";

interface ConditionalFormatBuilderProps {
  base: EntityType;
  view: View;
  onClose: () => void;
}

const OP_OPTIONS: Array<{ value: FilterOp; label: string }> = [
  { value: "eq", label: "= égal" },
  { value: "neq", label: "≠ différent" },
  { value: "contains", label: "contient" },
  { value: "not_contains", label: "ne contient pas" },
  { value: "starts_with", label: "commence par" },
  { value: "ends_with", label: "finit par" },
  { value: "gt", label: "> supérieur" },
  { value: "lt", label: "< inférieur" },
  { value: "gte", label: "≥ supérieur ou égal" },
  { value: "lte", label: "≤ inférieur ou égal" },
  { value: "is_empty", label: "est vide" },
  { value: "is_not_empty", label: "n'est pas vide" },
];

const COLOR_SWATCHES = [
  { bg: undefined, fg: undefined, name: "Aucun" },
  { bg: "#FEE2E2", fg: "#991B1B", name: "Rouge" },
  { bg: "#FED7AA", fg: "#9A3412", name: "Orange" },
  { bg: "#FEF3C7", fg: "#854D0E", name: "Jaune" },
  { bg: "#D1FAE5", fg: "#065F46", name: "Vert" },
  { bg: "#DBEAFE", fg: "#1E40AF", name: "Bleu" },
  { bg: "#E9D5FF", fg: "#5B21B6", name: "Violet" },
  { bg: "#FCE7F3", fg: "#9D174D", name: "Rose" },
];

export function ConditionalFormatBuilder({
  base,
  view,
  onClose,
}: ConditionalFormatBuilderProps) {
  const { update: updateView } = useViewMutations();
  const [rules, setRules] = useState<ConditionalFormatRule[]>(
    (view.conditionalFormats ?? []) as ConditionalFormatRule[],
  );

  const persist = (next: ConditionalFormatRule[]) => {
    setRules(next);
    updateView.mutate({ id: view.id, conditionalFormats: next });
  };

  const addRule = () => {
    const firstField = base.fields[0];
    if (!firstField) return;
    const r: ConditionalFormatRule = {
      id: `cf_${Math.random().toString(36).slice(2, 10)}`,
      fieldId: firstField.id,
      op: "eq",
      value: "",
      style: { bg: "#FEF3C7", fg: "#854D0E" },
      scope: "cell",
      enabled: true,
    };
    persist([...rules, r]);
  };

  const updateRule = (id: string, patch: Partial<ConditionalFormatRule>) => {
    persist(rules.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  };

  const removeRule = (id: string) => {
    persist(rules.filter((r) => r.id !== id));
  };

  return (
    <div
      className="absolute right-0 top-full z-50 mt-1 rounded-lg border shadow-lg"
      style={{
        width: 520,
        maxHeight: "70vh",
        overflowY: "auto",
        backgroundColor: "var(--surface-1)",
        borderColor: "var(--border-subtle)",
      }}
    >
      <div
        className="flex items-center justify-between border-b px-3 py-2"
        style={{ borderColor: "var(--border-subtle)" }}
      >
        <span className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
          Format conditionnel
        </span>
        <Button size="sm" variant="ghost" onPress={onClose}>
          Fermer
        </Button>
      </div>

      <div className="flex flex-col gap-2 p-3">
        {rules.length === 0 && (
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            Aucune règle. Ajoutez-en une pour colorer cellules ou lignes selon une
            condition.
          </p>
        )}
        {rules.map((r) => (
          <RuleRow
            key={r.id}
            rule={r}
            fields={base.fields as unknown as Field[]}
            onChange={(patch) => updateRule(r.id, patch)}
            onRemove={() => removeRule(r.id)}
          />
        ))}
        <Button
          size="sm"
          variant="ghost"
          onPress={addRule}
          className="flex items-center gap-1 self-start"
        >
          <Plus size={12} /> Ajouter une règle
        </Button>
      </div>
    </div>
  );
}

// ── Single rule row ─────────────────────────────────────────────────────────

function RuleRow({
  rule,
  fields,
  onChange,
  onRemove,
}: {
  rule: ConditionalFormatRule;
  fields: Field[];
  onChange: (patch: Partial<ConditionalFormatRule>) => void;
  onRemove: () => void;
}) {
  const needsValue = !(rule.op === "is_empty" || rule.op === "is_not_empty");
  const swatchIdx = Math.max(
    0,
    COLOR_SWATCHES.findIndex(
      (s) => s.bg === rule.style.bg && s.fg === rule.style.fg,
    ),
  );

  return (
    <div
      className="flex flex-col gap-2 rounded border p-2"
      style={{ borderColor: "var(--border-subtle)" }}
    >
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <input
          type="checkbox"
          checked={rule.enabled !== false}
          onChange={(e) => onChange({ enabled: e.target.checked })}
          aria-label="Activer cette règle"
        />
        <NativeSelect
          value={rule.fieldId}
          onChange={(v) => onChange({ fieldId: v })}
          options={fields.map((f) => ({ value: f.id, label: f.label || f.name }))}
        />
        <NativeSelect
          value={rule.op}
          onChange={(v) => onChange({ op: v as FilterOp })}
          options={OP_OPTIONS}
        />
        {needsValue && (
          <input
            type="text"
            value={String(rule.value ?? "")}
            onChange={(e) => onChange({ value: e.target.value })}
            placeholder="Valeur"
            className="rounded border px-2 py-1 text-xs"
            style={{
              borderColor: "var(--border-subtle)",
              backgroundColor: "var(--surface-0)",
              color: "var(--text-primary)",
              minWidth: 120,
            }}
            aria-label="Valeur de comparaison"
          />
        )}
        <NativeSelect
          value={rule.scope ?? "cell"}
          onChange={(v) => onChange({ scope: v as "cell" | "row" })}
          options={[
            { value: "cell", label: "Cellule" },
            { value: "row", label: "Ligne" },
          ]}
        />
        <Button isIconOnly size="sm" variant="ghost" onPress={onRemove} aria-label="Supprimer la règle">
          <Trash size={12} />
        </Button>
      </div>

      {/* Swatches couleurs */}
      <div className="flex flex-wrap items-center gap-1">
        {COLOR_SWATCHES.map((s, i) => (
          <button
            key={i}
            type="button"
            onClick={() =>
              onChange({
                style: { ...rule.style, bg: s.bg, fg: s.fg },
              })
            }
            className="flex h-6 w-6 items-center justify-center rounded border text-[10px]"
            style={{
              backgroundColor: s.bg ?? "transparent",
              color: s.fg ?? "var(--text-muted)",
              borderColor: i === swatchIdx ? "var(--accent)" : "var(--border-subtle)",
              borderWidth: i === swatchIdx ? 2 : 1,
            }}
            aria-label={`Couleur ${s.name}`}
            title={s.name}
          >
            Aa
          </button>
        ))}
        <label className="ml-2 flex items-center gap-1 text-[11px]" style={{ color: "var(--text-muted)" }}>
          <input
            type="checkbox"
            checked={Boolean(rule.style.bold)}
            onChange={(e) => onChange({ style: { ...rule.style, bold: e.target.checked } })}
          />
          Gras
        </label>
        <label className="flex items-center gap-1 text-[11px]" style={{ color: "var(--text-muted)" }}>
          <input
            type="checkbox"
            checked={Boolean(rule.style.italic)}
            onChange={(e) => onChange({ style: { ...rule.style, italic: e.target.checked } })}
          />
          Italique
        </label>
      </div>
    </div>
  );
}
