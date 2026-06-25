"use client";

/**
 * ColumnEditorSidebar — panneau latéral pleine hauteur pour gérer les colonnes
 * d'une Base (EntityType) dans le contexte d'une vue.
 *
 * Deux axes :
 *  - Visibilité/ordre → mutations sur la vue (views.update)
 *  - Ajout/édition/suppression → mutations sur le schéma (schemas.update)
 *
 * Rendu depuis AppShell quand ShellChromeContext.columnEditor !== null.
 */

import { useState, useCallback } from "react";
import { Button, Input, Checkbox, SelectRoot, SelectTrigger, SelectValue, SelectPopover, ListBox, ListBoxItem } from "@heroui/react";
import {
  X,
  Eye,
  EyeSlash,
  CaretUp,
  CaretDown,
  PencilSimple,
  Trash,
  Plus,
  Check,
} from "@phosphor-icons/react";
import type { EntityType, Field, FieldKind, SelectOption } from "@supernote/core";
import type { View } from "@supernote/ipc";
import { trpc } from "@/lib/trpc/client";
import { FieldKindBadge } from "@/components/schemas/FieldKindBadge";
import { FIELD_KINDS } from "@/components/schemas/fixtures";
import { coreFieldToIpc, ipcEntityTypeToCore } from "@/components/schemas/adapters";
import { useShellChrome } from "@/components/shell/shell-chrome-context";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useConfirm } from "@/lib/confirm";
import { parseFormula } from "@supernote/formulas";
import { useViewMutations, resolveVisibleFieldIds } from "./hooks";
import { labelForField } from "./filter-ops";

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeSlug(s: string) {
  return s.toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "");
}

function newFieldId() {
  return `f_${Math.random().toString(36).slice(2, 8)}`;
}

// ── Main component ────────────────────────────────────────────────────────────

interface ColumnEditorSidebarProps {
  base: EntityType;
  view: View;
  focusFieldId?: string;
  prefillFormula?: { expression: string; outputKind?: "text" | "number" | "date" | "bool" };
}

export function ColumnEditorSidebar({ base: baseSnapshot, view: viewSnapshot, focusFieldId, prefillFormula }: ColumnEditorSidebarProps) {
  const { closeColumnEditor } = useShellChrome();
  const isMobile = useIsMobile();
  const { update: updateView } = useViewMutations();
  const utils = trpc.useUtils();

  // Snapshots viennent du context (figés à l'ouverture). On refetch en frais
  // pour éviter les écrasements lors de mutations successives — sinon
  // commitFieldChange envoie `base.fields` stale et la 1ère colonne ajoutée
  // disparaît à la 2ème mutation.
  const { data: ipcBase } = trpc.schemas.get.useQuery(
    { id: baseSnapshot.id },
    { initialData: undefined },
  );
  const { data: freshView } = trpc.views.get.useQuery(
    { id: viewSnapshot.id },
    { initialData: undefined },
  );
  const base = ipcBase ? ipcEntityTypeToCore(ipcBase) : baseSnapshot;
  const view = freshView ?? viewSnapshot;

  const updateSchema = trpc.schemas.update.useMutation({
    onSuccess: () => {
      void utils.schemas.list.invalidate();
      void utils.schemas.get.invalidate({ id: base.id });
    },
  });

  // ── Visibility/order state ─────────────────────────────────────────────────

  const allFieldIds = base.fields.map((f) => f.id);
  const visible = resolveVisibleFieldIds(view, allFieldIds);
  const visibleSet = new Set(visible);
  const hidden = allFieldIds.filter((id) => !visibleSet.has(id));

  const commitView = (nextVisible: string[], nextHidden: string[]) => {
    updateView.mutate({ id: view.id, visibleFields: nextVisible, hiddenFields: nextHidden });
  };

  const toggleVisibility = (fieldId: string, currentlyVisible: boolean) => {
    if (currentlyVisible) {
      commitView(visible.filter((id) => id !== fieldId), [...hidden, fieldId]);
    } else {
      commitView([...visible, fieldId], hidden.filter((id) => id !== fieldId));
    }
  };

  const move = (index: number, delta: -1 | 1) => {
    const target = index + delta;
    if (target < 0 || target >= visible.length) return;
    const next = [...visible];
    const tmp = next[index]!;
    next[index] = next[target]!;
    next[target] = tmp;
    commitView(next, hidden);
  };

  // ── Field edit state ───────────────────────────────────────────────────────

  const [editingFieldId, setEditingFieldId] = useState<string | "new" | null>(
    focusFieldId ? focusFieldId : prefillFormula ? "new" : null,
  );

  const commitFieldChange = useCallback(
    (updatedField: Field, mode: "edit" | "add") => {
      const currentFields = base.fields;
      const nextFields =
        mode === "add"
          ? [...currentFields, updatedField]
          : currentFields.map((f) => (f.id === updatedField.id ? updatedField : f));
      updateSchema.mutate({ id: base.id, fields: nextFields.map(coreFieldToIpc) });
      setEditingFieldId(null);
    },
    [base.fields, base.id, updateSchema],
  );

  const deleteField = useCallback(
    (fieldId: string) => {
      const nextFields = base.fields.filter((f) => f.id !== fieldId);
      // Retire aussi de la vue si besoin
      const nextVisible = visible.filter((id) => id !== fieldId);
      const nextHidden = hidden.filter((id) => id !== fieldId);
      updateSchema.mutate({ id: base.id, fields: nextFields.map(coreFieldToIpc) });
      commitView(nextVisible, nextHidden);
    },
    [base.fields, base.id, updateSchema, visible, hidden], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const fieldById = new Map(base.fields.map((f) => [f.id, f]));

  return (
    <aside
      className="flex h-full flex-col border-l"
      style={{
        width: isMobile ? "100%" : 320,
        minWidth: isMobile ? 0 : 320,
        borderColor: "var(--border-subtle)",
        backgroundColor: "var(--surface-1)",
      }}
    >
      {/* Header */}
      <div
        className="flex shrink-0 items-center gap-2 border-b px-4"
        style={{ height: "var(--header-height)", borderColor: "var(--border-subtle)" }}
      >
        <span className="flex-1 truncate text-xs font-semibold" style={{ color: "var(--text-primary)" }}>
          {base.plural} · Colonnes
        </span>
        <Button
          variant="ghost"
          size="sm"
          onPress={closeColumnEditor}
          className="flex h-6 w-6 items-center justify-center rounded-md transition-colors hover:bg-[var(--surface-2)]"
          style={{ color: "var(--text-muted)" }}
          aria-label="Fermer"
        >
          <X size={13} />
        </Button>
      </div>

      {/* Field list */}
      <div className="flex-1 overflow-y-auto">
        {/* Visible fields */}
        {visible.length > 0 && (
          <div className="py-2">
            <SectionLabel label="Visibles" />
            {visible.map((fid, index) => {
              const field = fieldById.get(fid);
              if (!field) return null;
              return (
                <FieldRow
                  key={fid}
                  field={field}
                  isVisible
                  canMoveUp={index > 0}
                  canMoveDown={index < visible.length - 1}
                  isEditing={editingFieldId === fid}
                  isSaving={updateSchema.isPending}
                  currentBaseId={base.id}
                  currentBasePlural={base.plural}
                  onToggle={() => toggleVisibility(fid, true)}
                  onMoveUp={() => move(index, -1)}
                  onMoveDown={() => move(index, 1)}
                  onEdit={() => setEditingFieldId(editingFieldId === fid ? null : fid)}
                  onDelete={() => deleteField(fid)}
                  onSave={(f) => commitFieldChange(f, "edit")}
                  onCancelEdit={() => setEditingFieldId(null)}
                />
              );
            })}
          </div>
        )}

        {/* Hidden fields */}
        {hidden.length > 0 && (
          <div className="border-t py-2" style={{ borderColor: "var(--border-subtle)" }}>
            <SectionLabel label="Masquées" />
            {hidden.map((fid) => {
              const field = fieldById.get(fid);
              if (!field) return null;
              return (
                <FieldRow
                  key={fid}
                  field={field}
                  isVisible={false}
                  canMoveUp={false}
                  canMoveDown={false}
                  isEditing={editingFieldId === fid}
                  isSaving={updateSchema.isPending}
                  currentBaseId={base.id}
                  currentBasePlural={base.plural}
                  onToggle={() => toggleVisibility(fid, false)}
                  onMoveUp={() => {}}
                  onMoveDown={() => {}}
                  onEdit={() => setEditingFieldId(editingFieldId === fid ? null : fid)}
                  onDelete={() => deleteField(fid)}
                  onSave={(f) => commitFieldChange(f, "edit")}
                  onCancelEdit={() => setEditingFieldId(null)}
                />
              );
            })}
          </div>
        )}

        {/* Add field */}
        <div className="border-t px-3 py-3" style={{ borderColor: "var(--border-subtle)" }}>
          {editingFieldId === "new" ? (
            <FieldEditForm
              field={null}
              isSaving={updateSchema.isPending}
              prefill={prefillFormula}
              currentBaseId={base.id}
              currentBasePlural={base.plural}
              onSave={(f) => commitFieldChange(f, "add")}
              onCancel={() => setEditingFieldId(null)}
            />
          ) : (
            <Button
              variant="ghost"
              size="sm"
              onPress={() => setEditingFieldId("new")}
              className="flex w-full items-center gap-2 rounded-md border border-dashed px-3 py-2 text-xs transition-colors hover:bg-[var(--surface-2)]"
              style={{ borderColor: "var(--border-subtle)", color: "var(--accent)" }}
            >
              <Plus size={12} />
              Ajouter un champ
            </Button>
          )}
        </div>
      </div>
    </aside>
  );
}

// ── Section label ─────────────────────────────────────────────────────────────

function SectionLabel({ label }: { label: string }) {
  return (
    <div className="px-4 pb-1">
      <span
        className="text-[10px] font-semibold uppercase tracking-wide"
        style={{ color: "var(--text-muted)" }}
      >
        {label}
      </span>
    </div>
  );
}

// Icône-bouton compact partagé (HeroUI v3 Button ajoute son propre box-model
// qui rend les micro-boutons d'action incohérents — on reste en <button> natif).
const ICON_BTN =
  "inline-flex items-center justify-center rounded-md transition-colors text-[var(--text-muted)] hover:bg-[var(--surface-3)] hover:text-[var(--text-secondary)] disabled:pointer-events-none disabled:opacity-25";

// ── FieldRow ──────────────────────────────────────────────────────────────────

interface FieldRowProps {
  field: Field;
  isVisible: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  isEditing: boolean;
  isSaving: boolean;
  currentBaseId: string;
  currentBasePlural: string;
  onToggle: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onSave: (f: Field) => void;
  onCancelEdit: () => void;
}

function FieldRow({
  field,
  isVisible,
  canMoveUp,
  canMoveDown,
  isEditing,
  isSaving,
  currentBaseId,
  currentBasePlural,
  onToggle,
  onMoveUp,
  onMoveDown,
  onEdit,
  onDelete,
  onSave,
  onCancelEdit,
}: FieldRowProps) {
  const confirm = useConfirm();

  return (
    <div>
      <div
        className={`group flex items-center gap-2 rounded-md px-2 py-1.5 transition-colors hover:bg-[var(--surface-2)] ${
          !isVisible ? "opacity-55" : ""
        }`}
      >
        {/* Reorder arrows — compacts, révélés au survol */}
        <div className="flex w-4 flex-col items-center opacity-0 transition-opacity group-hover:opacity-100">
          {isVisible ? (
            <>
              <button
                type="button"
                onClick={onMoveUp}
                disabled={!canMoveUp}
                aria-label="Monter"
                className={`${ICON_BTN} h-3.5 w-4`}
              >
                <CaretUp size={10} weight="bold" />
              </button>
              <button
                type="button"
                onClick={onMoveDown}
                disabled={!canMoveDown}
                aria-label="Descendre"
                className={`${ICON_BTN} h-3.5 w-4`}
              >
                <CaretDown size={10} weight="bold" />
              </button>
            </>
          ) : null}
        </div>

        {/* Visibility toggle */}
        <button
          type="button"
          onClick={onToggle}
          className={`${ICON_BTN} h-7 w-7`}
          aria-label={isVisible ? "Masquer" : "Afficher"}
        >
          {isVisible ? <Eye size={14} /> : <EyeSlash size={14} />}
        </button>

        {/* Kind badge + label */}
        <FieldKindBadge kind={field.kind} />
        <span className="flex-1 truncate text-sm" style={{ color: "var(--text-primary)" }}>
          {labelForField(field)}
        </span>

        {/* Actions */}
        <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
          <button
            type="button"
            onClick={onEdit}
            className={`${ICON_BTN} h-7 w-7`}
            style={isEditing ? { color: "var(--accent)" } : undefined}
            aria-label="Modifier"
          >
            <PencilSimple size={14} />
          </button>
          <button
            type="button"
            onClick={async () => {
              const fieldLabel = field.label || field.name;
              const ok = await confirm({
                title: "Supprimer ce champ ?",
                body: (
                  <>
                    Le champ <strong>{fieldLabel}</strong> et toutes ses valeurs sur les entités existantes
                    seront perdus. Cette action est irréversible.
                  </>
                ),
                confirmLabel: "Supprimer",
                variant: "danger",
              });
              if (ok) {
                onDelete();
              }
            }}
            className={`${ICON_BTN} h-7 w-7`}
            aria-label="Supprimer"
          >
            <Trash size={14} />
          </button>
        </div>
      </div>

      {/* Inline edit form */}
      {isEditing && (
        <div className="border-t border-b px-3 py-3" style={{ borderColor: "var(--border-subtle)", backgroundColor: "var(--surface-0)" }}>
          <FieldEditForm
            field={field}
            isSaving={isSaving}
            currentBaseId={currentBaseId}
            currentBasePlural={currentBasePlural}
            onSave={onSave}
            onCancel={onCancelEdit}
          />
        </div>
      )}
    </div>
  );
}

// ── FieldEditForm ─────────────────────────────────────────────────────────────

const KIND_GROUPS = Array.from(new Set(FIELD_KINDS.map((k) => k.group)));

interface FieldEditFormProps {
  field: Field | null;
  isSaving: boolean;
  prefill?: { expression: string; outputKind?: FormulaOutputKind };
  currentBaseId: string;
  currentBasePlural: string;
  onSave: (f: Field) => void;
  onCancel: () => void;
}

type FormulaOutputKind = "text" | "number" | "date" | "bool";
type RollupAgg = "count" | "sum" | "avg" | "min" | "max" | "all" | "any";

// Familles de kinds partageant un même paramétrage.
const NUMBER_KINDS = new Set<FieldKind>([
  "number", "currency", "percent", "rating", "progress", "duration",
]);
// Kinds pour lesquels une « valeur par défaut » a du sens (saisie simple).
const DEFAULTABLE_KINDS = new Set<FieldKind>([
  "text", "longtext", "url", "email", "phone",
  "number", "currency", "percent", "rating", "progress", "duration",
  "bool", "select", "status", "date", "datetime",
]);
const AGG_LABELS: Record<RollupAgg, string> = {
  count: "Compter", sum: "Somme", avg: "Moyenne", min: "Minimum",
  max: "Maximum", all: "Tous vrais", any: "Au moins un",
};
const SELECT_TRIGGER_CLS = "w-full rounded border px-2 py-1.5 text-xs";
const SELECT_TRIGGER_STYLE = {
  borderColor: "var(--border)", backgroundColor: "var(--surface-1)", color: "var(--text-primary)",
} as const;
const FIELD_LABEL_CLS = "mb-1 block text-xs font-medium";

function FieldEditForm({ field, isSaving, prefill, currentBaseId, currentBasePlural, onSave, onCancel }: FieldEditFormProps) {
  const [label, setLabel] = useState(field?.label ?? (prefill ? "Formule" : ""));
  const [name, setName] = useState(field?.name ?? (prefill ? "formule" : ""));
  const [kind, setKind] = useState<FieldKind>(field?.kind ?? (prefill ? "formula" : "text"));
  const [required, setRequired] = useState(field?.required ?? false);
  const [options, setOptions] = useState<SelectOption[]>(
    (field as { options?: SelectOption[] })?.options ?? [],
  );
  const [expression, setExpression] = useState<string>(
    (field as { expression?: string })?.expression ?? prefill?.expression ?? "",
  );
  const [outputKind, setOutputKind] = useState<FormulaOutputKind>(
    ((field as { outputKind?: FormulaOutputKind })?.outputKind ?? prefill?.outputKind ?? "text"),
  );
  const [relTargetTypeId, setRelTargetTypeId] = useState<string>(
    (field as { targetTypeId?: string })?.targetTypeId ?? "",
  );
  const [relCardinality, setRelCardinality] = useState<"one_to_one" | "one_to_many" | "many_to_many">(
    ((field as { cardinality?: "one_to_one" | "one_to_many" | "many_to_many" })?.cardinality ?? "many_to_many"),
  );
  // Valeur par défaut (typée selon le kind à l'enregistrement).
  const [defaultValue, setDefaultValue] = useState<string>(() => {
    const dv = field?.defaultValue;
    if (dv === undefined || dv === null) return "";
    return typeof dv === "boolean" ? String(dv) : String(dv);
  });
  // Params famille « nombre ».
  const numF = field as { min?: number; max?: number; precision?: number; currencyCode?: string } | null;
  const [minVal, setMinVal] = useState<string>(numF?.min != null ? String(numF.min) : "");
  const [maxVal, setMaxVal] = useState<string>(numF?.max != null ? String(numF.max) : "");
  const [precision, setPrecision] = useState<string>(numF?.precision != null ? String(numF.precision) : "");
  const [currencyCode, setCurrencyCode] = useState<string>(numF?.currencyCode ?? "EUR");
  // Format date.
  const [dateFormat, setDateFormat] = useState<string>((field as { format?: string } | null)?.format ?? "");
  // Lookup / rollup wiring.
  const lrF = field as { relationFieldId?: string; targetFieldId?: string; aggregation?: RollupAgg } | null;
  const [relationFieldId, setRelationFieldId] = useState<string>(lrF?.relationFieldId ?? "");
  const [targetFieldId, setTargetFieldId] = useState<string>(lrF?.targetFieldId ?? "");
  const [aggregation, setAggregation] = useState<RollupAgg>(lrF?.aggregation ?? "count");
  const { data: allBases } = trpc.schemas.list.useQuery({ search: undefined });
  const [error, setError] = useState<string | null>(null);

  // Données pour les pickers lookup/rollup : champs Relation de la base courante,
  // puis champs de la base cible du champ Relation sélectionné.
  const currentBase = (allBases ?? []).find((b) => b.id === currentBaseId);
  const relationFields = (currentBase?.fields ?? []).filter((f) => f.type === "relation");
  const selectedRelation = relationFields.find((f) => f.id === relationFieldId);
  const targetBase = selectedRelation
    ? (allBases ?? []).find((b) => b.id === selectedRelation.targetTypeId)
    : undefined;
  const targetFields = targetBase?.fields ?? [];

  const handleLabelChange = (v: string) => {
    setLabel(v);
    if (!field) setName(makeSlug(v));
  };

  const handleSave = () => {
    if (!label.trim()) { setError("Le nom est requis"); return; }
    if ((kind === "select" || kind === "multiselect" || kind === "status") && options.length === 0) {
      setError("Au moins une option est requise");
      return;
    }
    if ((kind === "lookup" || kind === "rollup")) {
      if (!relationFieldId) { setError("Choisir un champ Relation"); return; }
      if (!targetFieldId) { setError("Choisir le champ à récupérer"); return; }
    }
    setError(null);

    // Slug auto-dérivé du libellé — l'utilisateur ne le gère plus.
    const finalName = (name.trim() || makeSlug(label.trim()) || field?.name || newFieldId());
    const base = { id: field?.id ?? newFieldId(), name: finalName, label: label.trim(), required, unique: field?.unique ?? false };

    // Valeur par défaut, coercée selon le kind.
    const coerceDefault = (): unknown => {
      if (!DEFAULTABLE_KINDS.has(kind) || defaultValue === "") return undefined;
      if (NUMBER_KINDS.has(kind)) { const n = Number(defaultValue); return Number.isFinite(n) ? n : undefined; }
      if (kind === "bool") return defaultValue === "true";
      return defaultValue;
    };
    const dv = coerceDefault();

    let extra: Record<string, unknown> = {};
    if (kind === "select" || kind === "multiselect" || kind === "status") extra = { options };
    else if (kind === "formula") extra = { expression: expression.trim(), outputKind };
    else if (kind === "rollup") extra = { relationFieldId, targetFieldId, aggregation };
    else if (kind === "lookup") extra = { relationFieldId, targetFieldId };
    else if (kind === "relation") {
      if (!relTargetTypeId) { setError("Choisir une base cible"); return; }
      extra = { targetTypeId: relTargetTypeId, cardinality: relCardinality };
    } else if (NUMBER_KINDS.has(kind)) {
      const num = (s: string) => (s.trim() === "" ? undefined : Number(s));
      extra = {
        min: num(minVal),
        max: num(maxVal),
        precision: precision.trim() === "" ? undefined : Math.max(0, Math.min(10, Number(precision) || 0)),
        ...(kind === "currency" ? { currencyCode: currencyCode.trim() || "EUR" } : {}),
      };
    } else if (kind === "date" || kind === "datetime") {
      extra = { format: dateFormat.trim() || undefined };
    }

    onSave({ ...base, kind, ...(dv !== undefined ? { defaultValue: dv } : {}), ...extra } as Field);
  };

  const needsOptions = kind === "select" || kind === "multiselect" || kind === "status";

  return (
    <div className="flex flex-col gap-2.5">
      <p className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
        {field ? "Modifier le champ" : "Nouveau champ"}
      </p>

      {/* Label */}
      <div>
        <label className="mb-1 block text-xs font-medium" style={{ color: "var(--text-secondary)" }}>Nom</label>
        <Input
          value={label}
          onChange={(e) => handleLabelChange(e.target.value)}
          placeholder="Ex : Montant"
          className="w-full text-xs"
          autoFocus
          onKeyDown={(e) => { if (e.key === "Enter") handleSave(); if (e.key === "Escape") onCancel(); }}
        />
      </div>

      {/* Kind */}
      <div>
        <label className="mb-1 block text-xs font-medium" style={{ color: "var(--text-secondary)" }}>Type</label>
        <SelectRoot
          selectedKey={kind}
          onSelectionChange={(key) => { if (key != null) setKind(key as FieldKind); }}
          className="w-full text-xs"
        >
          <SelectTrigger className="w-full rounded border px-2 py-1.5 text-xs" style={{ borderColor: "var(--border)", backgroundColor: "var(--surface-1)", color: "var(--text-primary)" }}>
            <SelectValue />
          </SelectTrigger>
          <SelectPopover>
            <ListBox>
              {FIELD_KINDS.map((k) => (
                <ListBoxItem key={k.kind} id={k.kind}>{k.label}</ListBoxItem>
              ))}
            </ListBox>
          </SelectPopover>
        </SelectRoot>
      </div>

      {/* Options (select/multiselect/status) */}
      {needsOptions && (
        <div>
          <label className="mb-1 block text-xs font-medium" style={{ color: "var(--text-secondary)" }}>Options</label>
          <div className="flex flex-col gap-1">
            {options.map((opt, i) => (
              <div key={i} className="flex items-center gap-1.5">
                <input
                  type="color"
                  value={opt.color ?? "#64748B"}
                  onChange={(e) => setOptions(options.map((o, j) => j === i ? { ...o, color: e.target.value } : o))}
                  className="h-5 w-5 cursor-pointer rounded border-0 bg-transparent"
                />
                <Input
                  value={opt.label}
                  onChange={(e) => setOptions(options.map((o, j) => j === i ? { ...o, label: e.target.value, value: makeSlug(e.target.value) || o.value } : o))}
                  className="flex-1 text-xs"
                  placeholder="Libellé"
                />
                <Button
                  variant="ghost"
                  size="sm"
                  onPress={() => setOptions(options.filter((_, j) => j !== i))}
                  className="rounded p-0.5 hover:bg-[var(--surface-3)]"
                  style={{ color: "var(--text-muted)" }}
                >
                  <X size={10} />
                </Button>
              </div>
            ))}
            <Button
              variant="ghost"
              size="sm"
              onPress={() => setOptions([...options, { value: `opt${options.length}`, label: "Nouvelle option", color: "#64748B" }])}
              className="mt-0.5 flex items-center gap-1 text-xs"
              style={{ color: "var(--accent)" }}
            >
              <Plus size={10} /> Ajouter une option
            </Button>
          </div>
        </div>
      )}

      {/* Formula expression + output kind */}
      {kind === "formula" && (
        <FormulaEditor
          expression={expression}
          onChangeExpression={setExpression}
          outputKind={outputKind}
          onChangeOutputKind={setOutputKind}
        />
      )}

      {/* Relation: picker base cible + cardinalité */}
      {kind === "relation" && (
        <div className="flex flex-col gap-2 rounded border px-2 py-2" style={{ borderColor: "var(--border-subtle)", backgroundColor: "var(--surface-0)" }}>
          <label className="block text-[10px] font-semibold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
            Base cible
          </label>
          <SelectRoot
            selectedKey={relTargetTypeId || null}
            onSelectionChange={(key) => setRelTargetTypeId(key ? String(key) : "")}
            className="w-full text-xs"
          >
            <SelectTrigger className="w-full rounded border px-2 py-1 text-xs" style={{ borderColor: "var(--border)", backgroundColor: "var(--surface-1)", color: "var(--text-primary)" }}>
              <SelectValue />
            </SelectTrigger>
            <SelectPopover>
              <ListBox>
                {(allBases ?? []).filter((b) => b.id !== currentBaseId).map((b) => (
                  <ListBoxItem key={b.id} id={b.id}>{b.plural || b.name}</ListBoxItem>
                ))}
                {(allBases ?? []).find((b) => b.id === currentBaseId) && (
                  <ListBoxItem key={currentBaseId} id={currentBaseId}>{currentBasePlural} (auto-référence)</ListBoxItem>
                )}
              </ListBox>
            </SelectPopover>
          </SelectRoot>
          <label className="mt-1 block text-[10px] font-semibold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
            Sélection
          </label>
          <div className="flex gap-1.5">
            <Button
              variant={relCardinality === "one_to_one" ? "primary" : "outline"}
              size="sm"
              onPress={() => setRelCardinality("one_to_one")}
              className="flex-1 rounded border px-2 py-1 text-[11px]"
              style={{
                borderColor: relCardinality === "one_to_one" ? "var(--accent)" : "var(--border)",
                backgroundColor: relCardinality === "one_to_one" ? "var(--accent)" : "transparent",
                color: relCardinality === "one_to_one" ? "var(--accent-foreground)" : "var(--text-secondary)",
              }}
            >
              Simple
            </Button>
            <Button
              variant={relCardinality === "many_to_many" ? "primary" : "outline"}
              size="sm"
              onPress={() => setRelCardinality("many_to_many")}
              className="flex-1 rounded border px-2 py-1 text-[11px]"
              style={{
                borderColor: relCardinality === "many_to_many" ? "var(--accent)" : "var(--border)",
                backgroundColor: relCardinality === "many_to_many" ? "var(--accent)" : "transparent",
                color: relCardinality === "many_to_many" ? "var(--accent-foreground)" : "var(--text-secondary)",
              }}
            >
              Multiple
            </Button>
          </div>
          <p className="text-[10px]" style={{ color: "var(--text-muted)" }}>
            Cellule affiche un picker de lignes dans la base cible.
          </p>
        </div>
      )}

      {/* Params famille nombre (number/currency/percent/rating/progress/duration) */}
      {NUMBER_KINDS.has(kind) && (
        <div className="flex flex-col gap-2">
          <div className="grid grid-cols-3 gap-2">
            <label className={FIELD_LABEL_CLS} style={{ color: "var(--text-secondary)" }}>
              Min
              <Input value={minVal} onChange={(e) => setMinVal(e.target.value)} placeholder="—" inputMode="decimal" className="w-full text-xs" />
            </label>
            <label className={FIELD_LABEL_CLS} style={{ color: "var(--text-secondary)" }}>
              Max
              <Input value={maxVal} onChange={(e) => setMaxVal(e.target.value)} placeholder="—" inputMode="decimal" className="w-full text-xs" />
            </label>
            <label className={FIELD_LABEL_CLS} style={{ color: "var(--text-secondary)" }}>
              Décimales
              <Input value={precision} onChange={(e) => setPrecision(e.target.value)} placeholder="0" inputMode="numeric" className="w-full text-xs" />
            </label>
          </div>
          {kind === "currency" && (
            <label className={FIELD_LABEL_CLS} style={{ color: "var(--text-secondary)" }}>
              Devise (code ISO)
              <Input value={currencyCode} onChange={(e) => setCurrencyCode(e.target.value)} placeholder="EUR" className="w-full text-xs" />
            </label>
          )}
          {(kind === "progress" || kind === "rating") && (
            <p className="text-[10px]" style={{ color: "var(--text-muted)" }}>
              Min/Max bornent {kind === "progress" ? "la barre de progression" : "la note"}.
            </p>
          )}
        </div>
      )}

      {/* Format date */}
      {(kind === "date" || kind === "datetime") && (
        <div>
          <label className={FIELD_LABEL_CLS} style={{ color: "var(--text-secondary)" }}>Format d'affichage</label>
          <SelectRoot
            selectedKey={dateFormat || "__auto"}
            onSelectionChange={(k) => setDateFormat(k === "__auto" || k == null ? "" : String(k))}
            className="w-full text-xs"
          >
            <SelectTrigger className={SELECT_TRIGGER_CLS} style={SELECT_TRIGGER_STYLE}><SelectValue /></SelectTrigger>
            <SelectPopover>
              <ListBox>
                <ListBoxItem id="__auto">Auto (locale)</ListBoxItem>
                <ListBoxItem id="YYYY-MM-DD">2026-06-24</ListBoxItem>
                <ListBoxItem id="DD/MM/YYYY">24/06/2026</ListBoxItem>
                <ListBoxItem id="DD MMM YYYY">24 juin 2026</ListBoxItem>
                {kind === "datetime" && <ListBoxItem id="DD/MM/YYYY HH:mm">24/06/2026 14:30</ListBoxItem>}
              </ListBox>
            </SelectPopover>
          </SelectRoot>
        </div>
      )}

      {/* Config lookup / rollup */}
      {(kind === "lookup" || kind === "rollup") && (
        <div className="flex flex-col gap-2 rounded border px-2 py-2" style={{ borderColor: "var(--border-subtle)", backgroundColor: "var(--surface-0)" }}>
          {relationFields.length === 0 ? (
            <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>
              Crée d'abord un champ <strong>Relation</strong> vers une autre base, puis reviens configurer ce champ.
            </p>
          ) : (
            <>
              <label className="block text-[10px] font-semibold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
                Via le champ relation
              </label>
              <SelectRoot
                selectedKey={relationFieldId || null}
                onSelectionChange={(k) => { setRelationFieldId(k ? String(k) : ""); setTargetFieldId(""); }}
                className="w-full text-xs"
              >
                <SelectTrigger className={SELECT_TRIGGER_CLS} style={SELECT_TRIGGER_STYLE}><SelectValue /></SelectTrigger>
                <SelectPopover>
                  <ListBox>
                    {relationFields.map((rf) => (
                      <ListBoxItem key={rf.id} id={rf.id}>{rf.label || rf.name}</ListBoxItem>
                    ))}
                  </ListBox>
                </SelectPopover>
              </SelectRoot>

              <label className="block text-[10px] font-semibold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
                {kind === "rollup" ? "Agréger le champ" : "Récupérer le champ"}
                {targetBase ? ` de « ${targetBase.plural || targetBase.name} »` : ""}
              </label>
              <SelectRoot
                selectedKey={targetFieldId || null}
                onSelectionChange={(k) => setTargetFieldId(k ? String(k) : "")}
                isDisabled={!selectedRelation}
                className="w-full text-xs"
              >
                <SelectTrigger className={SELECT_TRIGGER_CLS} style={SELECT_TRIGGER_STYLE}><SelectValue /></SelectTrigger>
                <SelectPopover>
                  <ListBox>
                    {targetFields.map((tf) => (
                      <ListBoxItem key={tf.id} id={tf.id}>{tf.label || tf.name}</ListBoxItem>
                    ))}
                  </ListBox>
                </SelectPopover>
              </SelectRoot>

              {kind === "rollup" && (
                <>
                  <label className="block text-[10px] font-semibold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
                    Agrégation
                  </label>
                  <SelectRoot
                    selectedKey={aggregation}
                    onSelectionChange={(k) => { if (k != null) setAggregation(k as RollupAgg); }}
                    className="w-full text-xs"
                  >
                    <SelectTrigger className={SELECT_TRIGGER_CLS} style={SELECT_TRIGGER_STYLE}><SelectValue /></SelectTrigger>
                    <SelectPopover>
                      <ListBox>
                        {(Object.keys(AGG_LABELS) as RollupAgg[]).map((a) => (
                          <ListBoxItem key={a} id={a}>{AGG_LABELS[a]}</ListBoxItem>
                        ))}
                      </ListBox>
                    </SelectPopover>
                  </SelectRoot>
                </>
              )}
            </>
          )}
        </div>
      )}

      {/* Valeur par défaut (selon le type) */}
      {DEFAULTABLE_KINDS.has(kind) && (
        <div>
          <label className={FIELD_LABEL_CLS} style={{ color: "var(--text-secondary)" }}>Valeur par défaut</label>
          {kind === "bool" ? (
            <SelectRoot
              selectedKey={defaultValue || "false"}
              onSelectionChange={(k) => setDefaultValue(String(k))}
              className="w-full text-xs"
            >
              <SelectTrigger className={SELECT_TRIGGER_CLS} style={SELECT_TRIGGER_STYLE}><SelectValue /></SelectTrigger>
              <SelectPopover>
                <ListBox>
                  <ListBoxItem id="false">Non coché</ListBoxItem>
                  <ListBoxItem id="true">Coché</ListBoxItem>
                </ListBox>
              </SelectPopover>
            </SelectRoot>
          ) : kind === "select" || kind === "status" ? (
            <SelectRoot
              selectedKey={defaultValue || "__none"}
              onSelectionChange={(k) => setDefaultValue(k === "__none" || k == null ? "" : String(k))}
              className="w-full text-xs"
            >
              <SelectTrigger className={SELECT_TRIGGER_CLS} style={SELECT_TRIGGER_STYLE}><SelectValue /></SelectTrigger>
              <SelectPopover>
                <ListBox>
                  <ListBoxItem id="__none">Aucune</ListBoxItem>
                  {options.map((o) => (
                    <ListBoxItem key={o.value} id={o.value}>{o.label}</ListBoxItem>
                  ))}
                </ListBox>
              </SelectPopover>
            </SelectRoot>
          ) : (
            <Input
              value={defaultValue}
              onChange={(e) => setDefaultValue(e.target.value)}
              placeholder={NUMBER_KINDS.has(kind) ? "Ex : 0" : kind === "date" || kind === "datetime" ? "YYYY-MM-DD" : "—"}
              inputMode={NUMBER_KINDS.has(kind) ? "decimal" : undefined}
              className="w-full text-xs"
            />
          )}
        </div>
      )}

      {/* Required */}
      <label className="flex cursor-pointer items-center gap-2 text-xs" style={{ color: "var(--text-secondary)" }}>
        <Checkbox
          isSelected={required}
          onChange={() => setRequired((v) => !v)}
        />
        Champ obligatoire
      </label>

      {/* Error */}
      {error && <p className="text-[11px]" style={{ color: "var(--destructive)" }}>{error}</p>}

      {/* Actions */}
      <div className="flex items-center justify-end gap-1.5 pt-0.5">
        <Button
          variant="ghost"
          size="sm"
          onPress={onCancel}
          className="rounded px-2 py-1 text-xs"
          style={{ color: "var(--text-muted)" }}
        >
          Annuler
        </Button>
        <Button
          variant="primary"
          size="sm"
          onPress={handleSave}
          isPending={isSaving}
          className="flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium"
          style={{ backgroundColor: "var(--accent)", color: "var(--accent-foreground)" }}
        >
          <Check size={10} /> {isSaving ? "…" : field ? "Mettre à jour" : "Créer"}
        </Button>
      </div>
    </div>
  );
}

// ── FormulaEditor ─────────────────────────────────────────────────────────────

interface FormulaEditorProps {
  expression: string;
  onChangeExpression: (v: string) => void;
  outputKind: FormulaOutputKind;
  onChangeOutputKind: (v: FormulaOutputKind) => void;
}

const FORMULA_HINTS = [
  "Concatenate(Left(Name, 3), \"-\", Year(Today()))",
  "If(Amount > 100, \"high\", \"low\")",
  "Round(Amount * 1.20, 2)",
  "DateAdd(Today(), 7, \"day\")",
  "thisRow.Title.Upper()",
];

function FormulaEditor({ expression, onChangeExpression, outputKind, onChangeOutputKind }: FormulaEditorProps) {
  const parseError = (() => {
    if (!expression.trim()) return null;
    const r = parseFormula(expression);
    return r.ok ? null : r.error.message;
  })();
  return (
    <div className="flex flex-col gap-2 rounded border px-2 py-2" style={{ borderColor: "var(--border-subtle)", backgroundColor: "var(--surface-0)" }}>
      <label className="block text-[10px] font-semibold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
        Expression
      </label>
      <textarea
        value={expression}
        onChange={(e) => onChangeExpression(e.target.value)}
        rows={3}
        placeholder='Ex : Concatenate("€ ", Round(Amount, 2))'
        spellCheck={false}
        className="w-full resize-y rounded border bg-transparent px-2 py-1.5 font-mono text-[11px]"
        style={{ borderColor: parseError ? "var(--destructive)" : "var(--border)", color: "var(--text-primary)" }}
      />
      {parseError && (
        <p className="font-mono text-[10px]" style={{ color: "var(--destructive)" }}>
          {parseError}
        </p>
      )}
      <div className="flex items-center gap-2">
        <label className="text-[11px]" style={{ color: "var(--text-secondary)" }}>Type de sortie</label>
        <SelectRoot
          selectedKey={outputKind}
          onSelectionChange={(key) => { if (key != null) onChangeOutputKind(key as FormulaOutputKind); }}
          className="text-[11px]"
        >
          <SelectTrigger className="rounded border px-1.5 py-1 text-[11px]" style={{ borderColor: "var(--border)", backgroundColor: "var(--surface-1)", color: "var(--text-primary)" }}>
            <SelectValue />
          </SelectTrigger>
          <SelectPopover>
            <ListBox>
              <ListBoxItem id="text">Texte</ListBoxItem>
              <ListBoxItem id="number">Nombre</ListBoxItem>
              <ListBoxItem id="date">Date</ListBoxItem>
              <ListBoxItem id="bool">Booléen</ListBoxItem>
            </ListBox>
          </SelectPopover>
        </SelectRoot>
      </div>
      <details className="text-[10px]" style={{ color: "var(--text-muted)" }}>
        <summary className="cursor-pointer select-none">Aide & exemples</summary>
        <div className="mt-1 flex flex-col gap-1">
          <p>
            Référence un champ : <code>{"{slug}"}</code> ou <code>nom_de_champ</code> ou <code>thisRow.slug</code>.
          </p>
          <p className="font-medium" style={{ color: "var(--text-secondary)" }}>Texte</p>
          <p>Concatenate, Format, Upper, Lower, Left, Right, Middle, Find, Contains, Replace, Trim, Length</p>
          <p className="font-medium" style={{ color: "var(--text-secondary)" }}>Nombres</p>
          <p>Sum, Avg, Round, RoundUp, RoundDown, Min, Max, Abs, Pow, Sqrt, Mod, Int, Sign, Log, Ln, Exp, Random</p>
          <p className="font-medium" style={{ color: "var(--text-secondary)" }}>Dates</p>
          <p>Today, Now, Date, Year, Month, Day, Hour, Weekday, MonthName, DateAdd, DateDiff, Format(d, &quot;YYYY-MM-DD&quot;)</p>
          <p className="font-medium" style={{ color: "var(--text-secondary)" }}>Logique</p>
          <p>If, IfElse, SwitchIf, Switch, And, Or, Not, IsBlank, IsNotBlank, IsNumber, IsText, IfBlank</p>
          <p className="font-medium" style={{ color: "var(--text-secondary)" }}>Listes</p>
          <p>Filter, Map, Reduce, Sort, Reverse, Unique, First, Last, Count, CountIf, Join, Contains, In</p>
          <p className="font-medium pt-1" style={{ color: "var(--text-secondary)" }}>Exemples</p>
          <ul className="flex flex-col gap-0.5 pl-3 font-mono">
            {FORMULA_HINTS.map((h) => (
              <li key={h}>
                <Button
                  variant="ghost"
                  size="sm"
                  onPress={() => onChangeExpression(h)}
                  className="text-left hover:underline"
                  style={{ color: "var(--accent)" }}
                >
                  {h}
                </Button>
              </li>
            ))}
          </ul>
        </div>
      </details>
    </div>
  );
}
