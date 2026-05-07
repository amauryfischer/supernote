"use client";

import Link from "next/link";
import { Edit2, Copy, Trash2, Plus, ArrowRight } from "lucide-react";
import type { EntityType, Field } from "@supernote/core";
import { RELATION_TYPES, ENTITY_TYPES, ENTITY_COUNTS } from "./fixtures";
import { FieldKindBadge } from "./FieldKindBadge";
import { getIcon } from "./icon-map";

interface TypePreviewProps {
  type: EntityType;
}

export function TypePreview({ type }: TypePreviewProps) {
  const Icon = getIcon(type.icon ?? "Box");
  const count = ENTITY_COUNTS[type.id] ?? 0;
  const relations = RELATION_TYPES.filter(
    (r) => r.sourceTypeId === type.id || r.targetTypeId === type.id
  );

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-4">
          <div
            className="flex h-12 w-12 items-center justify-center rounded-xl"
            style={{ backgroundColor: (type.color ?? "#6366F1") + "22", color: type.color ?? "#6366F1" }}
          >
            <Icon size={22} />
          </div>
          <div>
            <h2 className="text-xl font-semibold" style={{ color: "var(--text-primary)" }}>
              {type.name}
            </h2>
            <p className="text-sm" style={{ color: "var(--text-muted)" }}>
              {type.plural} · {count} entités · Vue par défaut : {type.defaultView ?? "table"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Link href={`/schemas/${type.id}`}>
            <button
              className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors"
              style={{ backgroundColor: "var(--accent)", color: "var(--accent-foreground)" }}
            >
              <Edit2 size={13} />
              Modifier
            </button>
          </Link>
          <button
            className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-[var(--surface-2)]"
            style={{ borderColor: "var(--border)", color: "var(--text-secondary)" }}
          >
            <Copy size={13} />
            Dupliquer
          </button>
          <button
            className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-red-50"
            style={{ borderColor: "var(--border)", color: "var(--danger)" }}
          >
            <Trash2 size={13} />
          </button>
        </div>
      </div>

      {/* Fields section */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
            Champs ({type.fields.length})
          </h3>
          <Link href={`/schemas/${type.id}`}>
            <button
              className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors hover:bg-[var(--surface-2)]"
              style={{ color: "var(--accent)" }}
            >
              <Plus size={12} />
              Champ
            </button>
          </Link>
        </div>
        <div
          className="divide-y rounded-xl border"
          style={{ borderColor: "var(--border)" }}
        >
          {type.fields.map((field) => (
            <FieldRow key={field.id} field={field} />
          ))}
        </div>
      </section>

      {/* Relations section */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
            Relations ({relations.length})
          </h3>
          <Link href="/schemas/relations">
            <button
              className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors hover:bg-[var(--surface-2)]"
              style={{ color: "var(--accent)" }}
            >
              <Plus size={12} />
              Relation
            </button>
          </Link>
        </div>
        {relations.length === 0 ? (
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>
            Aucune relation définie.
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {relations.map((rel) => {
              const isSrc = rel.sourceTypeId === type.id;
              const otherId = isSrc ? rel.targetTypeId : rel.sourceTypeId;
              const other = ENTITY_TYPES.find((t) => t.id === otherId);
              const OtherIcon = getIcon(other?.icon ?? "Box");
              const label = isSrc ? rel.forwardLabel : rel.inverseLabel;

              return (
                <div
                  key={rel.id}
                  className="flex items-center gap-3 rounded-lg border px-3 py-2.5"
                  style={{ borderColor: "var(--border-subtle)", backgroundColor: "var(--surface-1)" }}
                >
                  <span className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
                    {type.name}
                  </span>
                  <span
                    className="flex items-center gap-1 rounded px-2 py-0.5 text-xs"
                    style={{ backgroundColor: "var(--accent-subtle)", color: "var(--accent)" }}
                  >
                    <ArrowRight size={10} />
                    {label}
                  </span>
                  <OtherIcon size={14} style={{ color: other?.color ?? "#64748B" }} />
                  <span className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
                    {other?.name ?? otherId}
                  </span>
                  <span className="ml-auto text-xs" style={{ color: "var(--text-muted)" }}>
                    {rel.cardinality.replace("_", ":")}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Default view preview */}
      <section>
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
          Vue par défaut
        </h3>
        <div
          className="flex items-center justify-center rounded-xl border py-10 text-sm"
          style={{ borderColor: "var(--border-subtle)", color: "var(--text-muted)", backgroundColor: "var(--surface-1)" }}
        >
          Aperçu {type.defaultView ?? "table"} — {count} entités
        </div>
      </section>
    </div>
  );
}

function FieldRow({ field }: { field: Field }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <FieldKindBadge kind={field.kind} />
      <span className="flex-1 text-sm font-medium" style={{ color: "var(--text-primary)" }}>
        {field.label}
      </span>
      <span className="font-mono text-xs" style={{ color: "var(--text-muted)" }}>
        {field.name}
      </span>
      {field.required && (
        <span className="rounded bg-red-50 px-1.5 py-0.5 text-xs font-medium text-red-600">
          requis
        </span>
      )}
    </div>
  );
}
