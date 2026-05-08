"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { ArrowLeft, X } from "@phosphor-icons/react";
import { AppShell } from "@/components/shell";
import { ENTITY_TYPES, RELATION_TYPES } from "@/components/schemas/fixtures";

// RelationsGraph pulls in @xyflow/react and its CSS — that's >100KB of JS plus
// canvas tooling that nothing else in the app uses. Keeping it as a client-only
// dynamic import means the rest of the schemas surface (and any other route
// that ever transitively touches this module) skips the cost.
const RelationsGraph = dynamic(
  () =>
    import("@/components/schemas/RelationsGraph").then((m) => ({
      default: m.RelationsGraph,
    })),
  { ssr: false },
);
import { trpc } from "@/lib/trpc/client";
import { ipcEntityTypeToCore } from "@/components/schemas/adapters";
import type { RelationType, EntityType } from "@supernote/core";

export default function RelationsPage() {
  const router = useRouter();
  const [selectedRel, setSelectedRel] = useState<RelationType | null>(null);

  // Load entity types from tRPC; fallback to fixtures on error
  const { data: ipcTypes, isError: typesError } = trpc.schemas.list.useQuery({ search: undefined });
  const entityTypes: EntityType[] = typesError || !ipcTypes
    ? ENTITY_TYPES
    : ipcTypes.map(ipcEntityTypeToCore);

  // Load relation edges from tRPC (for counts / real data awareness)
  const { data: relationEdges } = trpc.relations.listAll.useQuery({ limit: 1000 });
  const edgeCount = relationEdges?.length ?? RELATION_TYPES.length;

  const srcType = selectedRel
    ? entityTypes.find((t) => t.id === selectedRel.sourceTypeId)
    : null;
  const tgtType = selectedRel
    ? entityTypes.find((t) => t.id === selectedRel.targetTypeId)
    : null;

  return (
    <AppShell>
      <div className="flex h-full flex-col">
        {/* Top bar */}
        <div
          className="flex items-center gap-3 border-b px-6 py-3"
          style={{ borderColor: "var(--border-subtle)", backgroundColor: "var(--surface-1)" }}
        >
          <button
            onClick={() => router.push("/schemas")}
            className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-[var(--surface-2)]"
            style={{ color: "var(--text-secondary)" }}
          >
            <ArrowLeft size={14} />
            Schémas
          </button>
          <span style={{ color: "var(--border)" }}>/</span>
          <span className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
            Graphe des relations
          </span>
          <span
            className="ml-2 rounded-full px-2 py-0.5 text-xs"
            style={{ backgroundColor: "var(--accent-subtle)", color: "var(--accent)" }}
          >
            {entityTypes.length} types · {edgeCount} relations
          </span>
        </div>

        {/* Graph area */}
        <div className="relative flex-1">
          <RelationsGraph
            entityTypes={entityTypes}
            onEdgeClick={setSelectedRel}
          />

          {/* Edge detail panel */}
          {selectedRel && (
            <div
              className="absolute bottom-6 right-6 z-10 flex w-80 flex-col gap-3 rounded-2xl border p-5 shadow-xl"
              style={{ backgroundColor: "var(--surface-0)", borderColor: "var(--border)" }}
            >
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                  Édition de relation
                </h3>
                <button
                  onClick={() => setSelectedRel(null)}
                  className="rounded-md p-1 hover:bg-[var(--surface-2)]"
                >
                  <X size={14} style={{ color: "var(--text-muted)" }} />
                </button>
              </div>

              {/* Source → Target */}
              <div className="flex items-center gap-2 text-sm">
                <span
                  className="rounded-md px-2 py-1 font-medium"
                  style={{
                    backgroundColor: (srcType?.color ?? "#6366F1") + "22",
                    color: srcType?.color ?? "#6366F1",
                  }}
                >
                  {srcType?.name ?? selectedRel.sourceTypeId}
                </span>
                <div className="flex flex-col items-center gap-0.5">
                  <span
                    className="rounded bg-[var(--accent-subtle)] px-2 py-0.5 text-xs"
                    style={{ color: "var(--accent)" }}
                  >
                    {selectedRel.forwardLabel}
                  </span>
                  <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                    {selectedRel.inverseLabel}
                  </span>
                </div>
                <span
                  className="rounded-md px-2 py-1 font-medium"
                  style={{
                    backgroundColor: (tgtType?.color ?? "#0EA5E9") + "22",
                    color: tgtType?.color ?? "#0EA5E9",
                  }}
                >
                  {tgtType?.name ?? selectedRel.targetTypeId}
                </span>
              </div>

              {/* Cardinality */}
              <div className="grid grid-cols-2 gap-3">
                <RelField label="Cardinalité" value={selectedRel.cardinality.replace(/_/g, ":")} />
                <RelField label="ID" value={selectedRel.id} mono />
              </div>

              {/* Fields */}
              <div>
                <p className="mb-1 text-xs font-medium" style={{ color: "var(--text-muted)" }}>
                  Champs de relation
                </p>
                {selectedRel.fields && selectedRel.fields.length > 0 ? (
                  <ul className="text-sm" style={{ color: "var(--text-secondary)" }}>
                    {selectedRel.fields.map((f: { id: string; label: string }) => (
                      <li key={f.id}>{f.label}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                    Aucun champ de relation
                  </p>
                )}
              </div>

              {/* Actions */}
              <div className="flex gap-2">
                <button
                  className="flex-1 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-[var(--surface-2)]"
                  style={{ borderColor: "var(--border)", color: "var(--text-secondary)" }}
                >
                  Modifier les labels
                </button>
                <button
                  className="rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-red-50"
                  style={{ borderColor: "var(--border)", color: "var(--danger)" }}
                >
                  Supprimer
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}

function RelField({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <p className="mb-0.5 text-xs font-medium" style={{ color: "var(--text-muted)" }}>{label}</p>
      <p className={`text-sm ${mono ? "font-mono" : ""}`} style={{ color: "var(--text-primary)" }}>
        {value}
      </p>
    </div>
  );
}
