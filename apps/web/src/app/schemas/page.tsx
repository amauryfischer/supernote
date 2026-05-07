"use client";

import { useState } from "react";
import Link from "next/link";
import { Plus, Database, Layers } from "lucide-react";
import { AppShell } from "@/components/shell";
import { TypeListItem } from "@/components/schemas/TypeListItem";
import { TypePreview } from "@/components/schemas/TypePreview";
import { ENTITY_TYPES } from "@/components/schemas/fixtures";

const SEED_IDS = new Set([
  "personne", "organisation", "projet", "interaction", "note",
  "daily", "tag", "account", "asset", "loan", "snapshot", "goal",
]);

export default function SchemasPage() {
  const [selectedId, setSelectedId] = useState<string>(ENTITY_TYPES[0]?.id ?? "personne");
  const [filter, setFilter] = useState<"all" | "seeds">("all");

  const displayed = filter === "seeds"
    ? ENTITY_TYPES.filter((t) => SEED_IDS.has(t.id))
    : ENTITY_TYPES;

  const selected = ENTITY_TYPES.find((t) => t.id === selectedId) ?? ENTITY_TYPES[0]!;

  return (
    <AppShell>
      <div className="flex h-full">
        {/* Left sidebar — 320px */}
        <aside
          className="flex shrink-0 flex-col border-r"
          style={{
            width: 320,
            borderColor: "var(--border-subtle)",
            backgroundColor: "var(--surface-1)",
          }}
        >
          {/* Header */}
          <div
            className="flex items-center justify-between border-b px-4 py-3"
            style={{ borderColor: "var(--border-subtle)" }}
          >
            <div className="flex items-center gap-2">
              <Database size={15} style={{ color: "var(--accent)" }} />
              <span className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                Types d'entités
              </span>
            </div>
            <Link href="/schemas/nouveau">
              <button
                className="flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium transition-colors"
                style={{ backgroundColor: "var(--accent)", color: "var(--accent-foreground)" }}
              >
                <Plus size={12} />
                Nouveau
              </button>
            </Link>
          </div>

          {/* Filter tabs */}
          <div
            className="flex gap-1 border-b p-2"
            style={{ borderColor: "var(--border-subtle)" }}
          >
            {(["all", "seeds"] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className="flex-1 rounded-md py-1.5 text-xs font-medium transition-colors"
                style={
                  filter === f
                    ? { backgroundColor: "var(--surface-3)", color: "var(--text-primary)" }
                    : { color: "var(--text-muted)" }
                }
              >
                {f === "all" ? "Mes types" : "Seeds Supernote"}
              </button>
            ))}
          </div>

          {/* List */}
          <div className="flex-1 overflow-y-auto p-2">
            {displayed.map((type) => (
              <TypeListItem
                key={type.id}
                type={type}
                selected={type.id === selectedId}
                onSelect={() => setSelectedId(type.id)}
              />
            ))}
          </div>

          {/* Footer */}
          <div
            className="border-t px-4 py-3"
            style={{ borderColor: "var(--border-subtle)" }}
          >
            <Link href="/schemas/relations">
              <button
                className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors hover:bg-[var(--surface-2)]"
                style={{ color: "var(--text-secondary)" }}
              >
                <Layers size={14} />
                Graphe des relations
              </button>
            </Link>
          </div>
        </aside>

        {/* Right — detail panel */}
        <main className="flex-1 overflow-y-auto" style={{ backgroundColor: "var(--surface-0)" }}>
          <TypePreview type={selected} />
        </main>
      </div>
    </AppShell>
  );
}
