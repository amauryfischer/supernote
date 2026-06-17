/**
 * Refresh a Coda-mirrored base from its binding: re-pull rows, upsert by the
 * reserved `_codaRowId`, delete rows that vanished from Coda, and re-wire
 * relations to the (possibly also refreshed) target bases.
 *
 * The schema itself is NOT re-negotiated in v1 — only data. A structural change
 * in Coda (new/removed columns) calls for a re-import.
 */

import { ok, err, type Result } from "@supernote/core/result";
import { trpcVanillaClient } from "@/lib/trpc/client";
import { listRows } from "./client";
import { rowToScalarFields, rowToRelationFields, CODA_ROW_ID_FIELD } from "./mapping";
import { getCodaBinding, saveCodaBinding, listCodaBindings } from "./bindings";

interface EntityListItem {
  id: string;
  fields: Record<string, unknown>;
}

async function listAllEntities(typeId: string): Promise<EntityListItem[]> {
  const res = (await trpcVanillaClient.entities.list.query({
    typeId,
    limit: 10000,
  } as never)) as { items: EntityListItem[] };
  return res.items ?? [];
}

/** Map a base's entities by their Coda row id. */
function indexByCodaRow(items: EntityListItem[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const e of items) {
    const rid = e.fields[CODA_ROW_ID_FIELD];
    if (typeof rid === "string" && rid) m.set(rid, e.id);
  }
  return m;
}

/**
 * Refresh one Coda base. Returns the counts applied. Errors short-circuit.
 */
export async function refreshCodaBase(
  baseId: string,
): Promise<Result<{ upserted: number; deleted: number }, Error>> {
  const binding = getCodaBinding(baseId);
  if (!binding) return err(new Error("Cette base n'est pas liée à Coda."));

  try {
    const rowsRes = await listRows(binding.docId, binding.tableId);
    if (!rowsRes.ok) return rowsRes;
    const rows = rowsRes.value;

    const byRowId = indexByCodaRow(await listAllEntities(baseId));
    const seen = new Set<string>();
    let upserted = 0;

    // ── Upsert scalar fields ──
    for (const row of rows) {
      seen.add(row.id);
      const fields = rowToScalarFields(binding.columns, row);
      const existing = byRowId.get(row.id);
      if (existing) {
        await trpcVanillaClient.entities.update.mutate({ id: existing, fields } as never);
      } else {
        const ent = (await trpcVanillaClient.entities.create.mutate({
          typeId: baseId,
          fields,
        } as never)) as { id: string };
        byRowId.set(row.id, ent.id);
      }
      upserted++;
    }

    // ── Delete rows that disappeared from Coda ──
    let deleted = 0;
    for (const [rowId, entId] of byRowId) {
      if (seen.has(rowId)) continue;
      await trpcVanillaClient.entities.delete.mutate({ id: entId } as never);
      deleted++;
    }

    // ── Re-wire relations to current target-base entities ──
    const hasRel = binding.columns.some((c) => c.kind === "relation");
    if (hasRel) {
      const baseByCodaTable = new Map<string, string>();
      for (const [bId, b] of Object.entries(listCodaBindings())) {
        baseByCodaTable.set(b.tableId, bId);
      }
      // Pre-build "codaTableId:rowId → entityId" for every referenced target
      // base, so the relation resolver stays synchronous.
      const targetTables = new Set(
        binding.columns
          .filter((c) => c.kind === "relation" && c.targetTableId)
          .map((c) => c.targetTableId as string),
      );
      const entityByRef = new Map<string, string>();
      for (const codaTable of targetTables) {
        const targetBase = baseByCodaTable.get(codaTable);
        if (!targetBase) continue;
        const items =
          targetBase === baseId
            ? Array.from(byRowId, ([rid, id]) => ({ id, fields: { [CODA_ROW_ID_FIELD]: rid } }))
            : await listAllEntities(targetBase);
        for (const e of items) {
          const rid = e.fields[CODA_ROW_ID_FIELD];
          if (typeof rid === "string" && rid) entityByRef.set(`${codaTable}:${rid}`, e.id);
        }
      }
      const resolve = (tableId: string | null, rowId: string, fallback?: string) =>
        entityByRef.get(`${tableId ?? fallback}:${rowId}`);

      for (const row of rows) {
        const relFields = rowToRelationFields(binding.columns, row, resolve);
        if (Object.keys(relFields).length === 0) continue;
        const entId = byRowId.get(row.id);
        if (!entId) continue;
        await trpcVanillaClient.entities.update.mutate({ id: entId, fields: relFields } as never);
      }
    }

    saveCodaBinding(baseId, { ...binding, lastRefreshedAt: Date.now() });
    return ok({ upserted, deleted });
  } catch (e) {
    return err(e instanceof Error ? e : new Error(String(e)));
  }
}
