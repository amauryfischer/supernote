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
    label: f.name,
    required: f.required ?? false,
    unique: f.unique ?? false,
    helpText: f.helpText,
    group: f.group,
  };
  const kind = f.type as FieldKind;

  if (kind === "select" || kind === "multiselect") {
    return { ...base, kind, options: (f.options ?? []) as SelectOption[] };
  }
  if (kind === "status") {
    return { ...base, kind, options: (f.options ?? []) as SelectOption[] };
  }
  if (kind === "formula") {
    return { ...base, kind, expression: f.formulaExpr ?? "", outputKind: "text" };
  }
  if (kind === "rollup") {
    return { ...base, kind, relationFieldId: "", targetFieldId: "", aggregation: "count" };
  }
  if (kind === "lookup") {
    return { ...base, kind, relationFieldId: "", targetFieldId: "" };
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
    defaultView: et.defaultView as EntityType["defaultView"],
  };
}

/** Convert a core Field back to an IPC FieldDefinition for mutations */
export function coreFieldToIpc(f: Field): FieldDefinition {
  const base: FieldDefinition = {
    id: f.id,
    name: f.name,
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
