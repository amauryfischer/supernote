/**
 * Coda → Supernote import orchestrator.
 *
 * Reproduces selected Coda tables as read-only Supernote bases, reconstructing
 * relations between tables imported together. Pure mapping lives in
 * `./mapping`; this module owns the tRPC choreography and the multi-pass
 * ordering relations require.
 *
 * Passes:
 *   1. Schema    — create an EntityType per table (relation targets unresolved),
 *                  then patch in each relation's `targetTypeId` once every base
 *                  id is known (handles circular A↔B relations).
 *   2. Rows      — create one entity per Coda row with its scalar fields and the
 *                  reserved `_codaRowId`; record `tableId:rowId → entityId`.
 *   3. Relations — resolve each relation cell's row refs to entity ids and patch
 *                  them in (entities.update merges, so scalars are preserved).
 */

import { ok, err, type Result } from "@supernote/core/result";
import type { FieldKind } from "@supernote/core";
import { trpcVanillaClient } from "@/lib/trpc/client";
import { listColumns, listRows } from "./client";
import {
  mapColumn,
  rowToScalarFields,
  rowToRelationFields,
  type MappedColumn,
} from "./mapping";
import { saveCodaBinding } from "./bindings";
import type { CodaRow } from "./types";

export interface ImportTarget {
  docId: string;
  docName: string;
  tableId: string;
  tableName: string;
}

export interface ImportProgress {
  phase: "schema" | "rows" | "relations" | "done";
  /** Human label of the current unit of work. */
  label: string;
  done: number;
  total: number;
}

/** An IPC field definition object (stored raw by the worker). */
interface FieldDef {
  id: string;
  name: string;
  label: string;
  type: FieldKind;
  required: boolean;
  unique: boolean;
  targetTypeId?: string;
  cardinality?: "one_to_one" | "many_to_many";
}

/** Build field definitions from mapped columns, de-duplicating field names. */
function buildFieldDefs(
  columns: MappedColumn[],
  targetTypeId: (codaTableId: string) => string,
): FieldDef[] {
  const used = new Set<string>(["_codaRowId"]);
  return columns.map((c) => {
    let name = c.name;
    for (let i = 2; used.has(name); i++) name = `${c.name}_${i}`;
    used.add(name);
    const def: FieldDef = {
      id: c.fieldId,
      name,
      label: c.label,
      type: c.kind,
      required: false,
      unique: false,
    };
    if (c.kind === "relation") {
      def.targetTypeId = c.targetTableId ? targetTypeId(c.targetTableId) : "";
      def.cardinality = c.cardinality ?? "many_to_many";
    }
    return def;
  });
}

interface TablePlan {
  target: ImportTarget;
  columns: MappedColumn[];
  fields: FieldDef[];
  baseId: string;
  rows: CodaRow[];
}

/**
 * Run a full import of the selected tables. Returns the created base ids.
 * `onProgress` is optional; failures short-circuit to an `err`.
 */
export async function importCodaTables(
  targets: ImportTarget[],
  onProgress?: (p: ImportProgress) => void,
): Promise<Result<{ baseIds: string[] }, Error>> {
  if (targets.length === 0) return ok({ baseIds: [] });
  const selected = new Set(targets.map((t) => t.tableId));
  const isSelected = (id: string) => selected.has(id);
  const report = (p: ImportProgress) => onProgress?.(p);

  try {
    // ── Pass 1a: columns + create each EntityType (relations unresolved). ──
    const plans: TablePlan[] = [];
    const baseIdByTable = new Map<string, string>();
    let i = 0;
    for (const target of targets) {
      report({ phase: "schema", label: target.tableName, done: i, total: targets.length });
      const cols = await listColumns(target.docId, target.tableId);
      if (!cols.ok) return cols;
      const columns = cols.value
        .map((c) => mapColumn(c, isSelected))
        .filter((m): m is MappedColumn => m !== null);
      // targetTypeId not known yet → "" placeholder, patched in pass 1b.
      const fields = buildFieldDefs(columns, () => "");
      const created = (await trpcVanillaClient.schemas.create.mutate({
        name: target.tableName,
        plural: target.tableName,
        icon: "Table",
        fields,
      } as never)) as { id: string };
      baseIdByTable.set(target.tableId, created.id);
      plans.push({ target, columns, fields, baseId: created.id, rows: [] });
      i++;
    }

    // ── Pass 1b: patch relation targetTypeId now that all bases exist. ──
    for (const plan of plans) {
      const hasRel = plan.columns.some((c) => c.kind === "relation");
      if (!hasRel) continue;
      const fields = buildFieldDefs(plan.columns, (codaTableId) =>
        baseIdByTable.get(codaTableId) ?? "",
      );
      plan.fields = fields;
      await trpcVanillaClient.schemas.update.mutate({ id: plan.baseId, fields } as never);
    }

    // ── Pass 2: rows → entities (scalars only), record row→entity map. ──
    // Keyed "codaTableId:codaRowId" → Supernote entity id.
    const entityByRef = new Map<string, string>();
    const totalRowsPlan = plans.length; // table granularity for progress
    let r = 0;
    for (const plan of plans) {
      report({ phase: "rows", label: plan.target.tableName, done: r, total: totalRowsPlan });
      const rowsRes = await listRows(plan.target.docId, plan.target.tableId);
      if (!rowsRes.ok) return rowsRes;
      plan.rows = rowsRes.value;
      for (const row of plan.rows) {
        const fields = rowToScalarFields(plan.columns, row);
        const ent = (await trpcVanillaClient.entities.create.mutate({
          typeId: plan.baseId,
          fields,
        } as never)) as { id: string };
        entityByRef.set(`${plan.target.tableId}:${row.id}`, ent.id);
      }
      r++;
    }

    // ── Pass 3: wire relations via entities.update (merge keeps scalars). ──
    const resolve = (tableId: string | null, rowId: string, fallback?: string) =>
      entityByRef.get(`${tableId ?? fallback}:${rowId}`);
    let w = 0;
    for (const plan of plans) {
      const hasRel = plan.columns.some((c) => c.kind === "relation");
      if (!hasRel) {
        w++;
        continue;
      }
      report({ phase: "relations", label: plan.target.tableName, done: w, total: plans.length });
      for (const row of plan.rows) {
        const relFields = rowToRelationFields(plan.columns, row, resolve);
        if (Object.keys(relFields).length === 0) continue;
        const entId = entityByRef.get(`${plan.target.tableId}:${row.id}`);
        if (!entId) continue;
        await trpcVanillaClient.entities.update.mutate({ id: entId, fields: relFields } as never);
      }
      w++;
    }

    // ── Persist bindings for refresh + read-only enforcement. ──
    const importedAt = Date.now();
    for (const plan of plans) {
      saveCodaBinding(plan.baseId, {
        docId: plan.target.docId,
        docName: plan.target.docName,
        tableId: plan.target.tableId,
        tableName: plan.target.tableName,
        columns: plan.columns,
        importedAt,
      });
    }

    report({ phase: "done", label: "", done: plans.length, total: plans.length });
    return ok({ baseIds: plans.map((p) => p.baseId) });
  } catch (e) {
    return err(e instanceof Error ? e : new Error(String(e)));
  }
}
