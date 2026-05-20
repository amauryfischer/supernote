/**
 * Adapters to convert IPC (tRPC) types to @supernote/core UI types.
 *
 * The IPC schema uses `FieldDefinition` with a `type` field,
 * while the UI uses the discriminated `Field` union with a `kind` field.
 */

import type { EntityType, Field, FieldKind, SelectOption, RelationType } from "@supernote/core";
import type {
  EntityType as IpcEntityType,
  FieldDefinition,
  RelationType as IpcRelationType,
} from "@supernote/ipc";

/** Map an IPC FieldDefinition to a core Field */
export function ipcFieldToCore(f: FieldDefinition): Field {
  const base = {
    id: f.id,
    name: f.name,
    // Préserve le libellé humain — fallback sur `name` (slug) seulement quand
    // l'ancien enregistrement n'avait pas de label persisté.
    label: f.label?.trim() ? f.label : f.name,
    required: f.required ?? false,
    unique: f.unique ?? false,
    helpText: f.helpText,
    group: f.group,
  };
  // Rétro-compatibilité : les seeds historiques persistaient `kind` alors que
  // le contrat IPC actuel utilise `type`. On accepte les deux pour que les
  // vaults pré-existants continuent d'afficher le bon kind.
  const kind = (f.type ?? (f as unknown as { kind?: string }).kind ?? "text") as FieldKind;

  if (kind === "select" || kind === "multiselect") {
    return { ...base, kind, options: (f.options ?? []) as SelectOption[] };
  }
  if (kind === "status") {
    return { ...base, kind, options: (f.options ?? []) as SelectOption[] };
  }
  if (kind === "formula") {
    return {
      ...base,
      kind,
      expression: f.formulaExpr ?? "",
      outputKind: (f.formulaOutputKind ?? "text") as "text" | "number" | "date" | "bool",
      outputFormat: f.formulaOutputFormat,
    };
  }
  if (kind === "rollup") {
    return { ...base, kind, relationFieldId: "", targetFieldId: "", aggregation: "count" };
  }
  if (kind === "lookup") {
    return { ...base, kind, relationFieldId: "", targetFieldId: "" };
  }
  if (kind === "ai") {
    return {
      ...base,
      kind,
      prompt: f.aiPrompt ?? "",
      outputKind: (f.aiOutputKind ?? "text") as "text" | "longtext" | "number" | "bool" | "select",
      model: f.aiModel,
      autoRecompute: f.aiAutoRecompute,
    };
  }
  // All other kinds (text, number, date, bool, relation, file, auto, etc.)
  return { ...base, kind } as Field;
}

/** Map an IPC EntityType to a core EntityType */
export function ipcEntityTypeToCore(et: IpcEntityType): EntityType {
  return {
    id: et.id,
    name: et.name,
    plural: et.plural,
    icon: et.icon,
    color: et.color,
    fields: et.fields.map(ipcFieldToCore),
    defaultPath: et.defaultPath ?? "",
    fileNamePattern: et.fileNamePattern ?? "{name}",
  };
}

/** Convert a core Field back to an IPC FieldDefinition for mutations */
export function coreFieldToIpc(f: Field): FieldDefinition {
  const base: FieldDefinition = {
    id: f.id,
    name: f.name,
    label: f.label,
    type: f.kind as FieldDefinition["type"],
    required: f.required,
    unique: f.unique,
    multiple: false,
    helpText: f.helpText,
    group: f.group,
  };

  if (f.kind === "select" || f.kind === "multiselect" || f.kind === "status") {
    base.options = [...f.options] as FieldDefinition["options"];
  }
  if (f.kind === "formula") {
    base.formulaExpr = f.expression;
    const ok = f.outputKind;
    if (ok === "text" || ok === "number" || ok === "date" || ok === "bool") {
      base.formulaOutputKind = ok;
    }
    if (f.outputFormat) base.formulaOutputFormat = f.outputFormat;
  }
  if (f.kind === "ai") {
    base.aiPrompt = f.prompt;
    base.aiOutputKind = f.outputKind;
    if (f.model) base.aiModel = f.model;
    if (f.autoRecompute !== undefined) base.aiAutoRecompute = f.autoRecompute;
  }
  return base;
}

/** Map an IPC RelationType to a core RelationType */
export function ipcRelationTypeToCore(r: IpcRelationType): RelationType {
  return {
    id: r.id,
    forwardLabel: r.forwardLabel,
    inverseLabel: r.inverseLabel,
    sourceTypeId: r.sourceTypeId ?? "",
    targetTypeId: r.targetTypeId ?? "",
    cardinality: (r.cardinality === "one-to-one"
      ? "one_to_one"
      : r.cardinality === "one-to-many"
      ? "one_to_many"
      : "many_to_many") as RelationType["cardinality"],
  };
}
