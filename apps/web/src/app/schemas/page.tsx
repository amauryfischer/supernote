"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Plus, Database, Stack } from "@phosphor-icons/react";
import { AppShell, useMobileFab, useMobileTitle } from "@/components/shell";
import { useIsMobile } from "@/hooks/useIsMobile";
import { TypeListItem } from "@/components/schemas/TypeListItem";
import { TypePreview } from "@/components/schemas/TypePreview";
import { ENTITY_TYPES } from "@/components/schemas/fixtures";
import { trpc } from "@/lib/trpc/client";
import type { EntityType } from "@supernote/core";
import { ipcEntityTypeToCore } from "@/components/schemas/adapters";
import { Skeleton } from "@supernote/ui";

const SEED_IDS = new Set([
  "personne", "organisation", "interaction", "note",
  "daily", "tag", "account", "asset", "loan", "snapshot", "goal",
]);

const CUSTOM_TYPE_EXAMPLES = ["Livre", "Recette", "Voyage"];

function EmptyCustomTypes() {
  return (
    <div
      className="mx-3 mt-2 rounded-xl border p-4 text-center"
      style={{ borderColor: "var(--border-subtle)", backgroundColor: "var(--surface-2)" }}
    >
      <p className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
        Aucun type personnalisé.
      </p>
      <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
        Les seeds (Personne, Note, etc.) sont disponibles.
      </p>
      <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
        Créer ton premier type custom :{" "}
        {CUSTOM_TYPE_EXAMPLES.join(", ")}…
      </p>
      <Link href="/schemas/nouveau">
        <button
          className="mt-3 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors"
          style={{ backgroundColor: "var(--accent)", color: "var(--accent-foreground)" }}
        >
          Créer un type
        </button>
      </Link>
    </div>
  );
}

export default function SchemasPage() {
  const router = useRouter();
  const isMobile = useIsMobile();
  const [selectedId, setSelectedId] = useState<string>("");
  const [filter, setFilter] = useState<"all" | "seeds">("all");

  const { data: ipcTypes, isLoading, isError } = trpc.schemas.list.useQuery({ search: undefined });

  // Adapt IPC types to core types, fallback to fixtures on error
  const coreTypes: EntityType[] = isError || !ipcTypes
    ? ENTITY_TYPES
    : ipcTypes.map(ipcEntityTypeToCore);

  const displayed = filter === "seeds"
    ? coreTypes.filter((t) => SEED_IDS.has(t.id))
    : coreTypes;

  const customTypes = coreTypes.filter((t) => !SEED_IDS.has(t.id));

  const effectiveSelectedId = selectedId || displayed[0]?.id || "";
  const selected = coreTypes.find((t) => t.id === effectiveSelectedId) ?? coreTypes[0];

  useMobileTitle(isMobile ? "Schémas" : null);
  useMobileFab(
    isMobile
      ? { icon: Plus, label: "Nouveau type", onPress: () => router.push("/schemas/nouveau") }
      : null,
  );

  return (
    <AppShell>
      <div className="flex h-full">
        {/* Left sidebar — full width on mobile, 320px on desktop */}
        <aside
          className="flex shrink-0 flex-col border-r"
          style={{
            width: isMobile ? "100%" : 320,
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
                Types d&apos;entités
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
            {isLoading && (
              <div className="flex flex-col gap-2 p-2">
                {Array.from({ length: 5 }, (_, i) => (
                  <Skeleton key={i} className="h-9 w-full" />
                ))}
              </div>
            )}
            {!isLoading && filter === "all" && customTypes.length === 0 && (
              <EmptyCustomTypes />
            )}
            {!isLoading && displayed.map((type) => (
              <TypeListItem
                key={type.id}
                type={type}
                selected={type.id === effectiveSelectedId}
                onSelect={() => {
                  if (isMobile) {
                    router.push(`/schemas/${type.id}`);
                  } else {
                    setSelectedId(type.id);
                  }
                }}
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
                <Stack size={14} />
                Graphe des relations
              </button>
            </Link>
          </div>
        </aside>

        {/* Right — detail panel — hidden on mobile (user taps a type to go to [id]) */}
        {!isMobile && (
          <main className="flex-1 overflow-y-auto" style={{ backgroundColor: "var(--surface-0)" }}>
            {selected ? (
              <TypePreview type={selected} />
            ) : (
              <div className="flex h-full items-center justify-center">
                <p style={{ color: "var(--text-muted)" }}>Sélectionnez un type</p>
              </div>
            )}
          </main>
        )}
      </div>
    </AppShell>
  );
}
