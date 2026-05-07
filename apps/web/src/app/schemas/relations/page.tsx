"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, X } from "@phosphor-icons/react";
import { AppShell } from "@/components/shell";
import { RelationsGraph } from "@/components/schemas/RelationsGraph";
import { ENTITY_TYPES } from "@/components/schemas/fixtures";
import type { RelationType } from "@supernote/core";

export default function RelationsPage() {
  const router = useRouter();
  const [selectedRel, setSelectedRel] = useState<RelationType | null>(null);

  const srcType = selectedRel ? ENTITY_TYPES.find((t) => t.id === selectedRel.sourceTypeId) : null;
  const tgtType = selectedRel ? ENTITY_TYPES.find((t) => t.id === selectedRel.targetTypeId) : null;

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
          <span className="ml-2 rounded-full px-2 py-0.5 text-xs" style={{ backgroundColor: "var(--accent-subtle)", color: "var(--accent)" }}>
            {ENTITY_TYPES.length} types · {/* RELATION_TYPES.length */ 8} relations
          </span>
        </div>

        {/* Graph area */}
        <div className="relative flex-1">
          <RelationsGraph onEdgeClick={setSelectedRel} />

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
                  style={{ backgroundColor: (srcType?.color ?? "#6366F1") + "22", color: srcType?.color ?? "#6366F1" }}
                >
                  {srcType?.name ?? selectedRel.sourceTypeId}
                </span>
                <div className="flex flex-col items-center gap-0.5">
                  <span className="rounded bg-[var(--accent-subtle)] px-2 py-0.5 text-xs" style={{ color: "var(--accent)" }}>
                    {selectedRel.forwardLabel}
                  </span>
                  <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                    {selectedRel.inverseLabel}
                  </span>
                </div>
                <span
                  className="rounded-md px-2 py-1 font-medium"
                  style={{ backgroundColor: (tgtType?.color ?? "#0EA5E9") + "22", color: tgtType?.color ?? "#0EA5E9" }}
                >
                  {tgtType?.name ?? selectedRel.targetTypeId}
                </span>
              </div>

              {/* Cardinality */}
              <div className="grid grid-cols-2 gap-3">
                <Field label="Cardinalité" value={selectedRel.cardinality.replace("_", ":")} />
                <Field label="ID" value={selectedRel.id} mono />
              </div>

              {/* Fields */}
              <div>
                <p className="mb-1 text-xs font-medium" style={{ color: "var(--text-muted)" }}>
                  Champs de relation
                </p>
                {selectedRel.fields && selectedRel.fields.length > 0 ? (
                  <ul className="text-sm" style={{ color: "var(--text-secondary)" }}>
                    {selectedRel.fields.map((f) => (
                      <li key={f.id}>{f.label}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-xs" style={{ color: "var(--text-muted)" }}>Aucun champ de relation</p>
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

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <p className="mb-0.5 text-xs font-medium" style={{ color: "var(--text-muted)" }}>{label}</p>
      <p className={`text-sm ${mono ? "font-mono" : ""}`} style={{ color: "var(--text-primary)" }}>{value}</p>
    </div>
  );
}
