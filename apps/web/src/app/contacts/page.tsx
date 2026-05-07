"use client";

import { AppShell } from "@/components/shell";
import {
  BulkActionBar,
  ContactGallery,
  ContactsTable,
  ORGANISATIONS,
  ALL_RELATION_TYPES,
  RelationChip,
  useContactsSource,
} from "@/components/contacts";
import type { RelationType, Contact } from "@/components/contacts";
import { GridFour, List, Plus, MagnifyingGlass, X, UploadSimple } from "@phosphor-icons/react";
import Link from "next/link";
import { useState, useMemo } from "react";
import { SkeletonCard } from "@supernote/ui";

type ViewMode = "table" | "gallery";

/** Empty state shown when there are truly no contacts at all. */
function EmptyState() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 py-24 text-center">
      <p className="text-base font-medium" style={{ color: "var(--text-secondary)" }}>
        Aucun contact.
      </p>
      <p className="text-sm" style={{ color: "var(--text-muted)" }}>
        Importez depuis vCard / Google Contacts ou créez manuellement.
      </p>
      <Link
        href="/contacts/nouveau"
        className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-opacity hover:opacity-90"
        style={{ backgroundColor: "var(--accent)", color: "var(--accent-foreground)" }}
      >
        <Plus size={13} />
        Nouveau contact
      </Link>
    </div>
  );
}

export default function ContactsPage() {
  const [view, setView] = useState<ViewMode>("table");
  const [query, setQuery] = useState("");
  const [activeTypes, setActiveTypes] = useState<RelationType[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  // Resolves contacts from tRPC (Electron) or fixtures (browser / mode dégradé).
  // The query is only enabled when window.__supernoteIPC is available, which
  // prevents the race where isError stays false while data is undefined.
  const { contacts: allContacts, mode, isLoading } = useContactsSource();

  // Org names map — fixtures are already embedded in components, this covers live data.
  const orgNames = useMemo<Map<string, string>>(
    () => new Map(ORGANISATIONS.map((o) => [o.id, o.name])),
    [],
  );

  const filtered = useMemo<Contact[]>(() => {
    const q = query.trim().toLowerCase();
    return allContacts.filter((c) => {
      const matchQ =
        q.length === 0 ||
        c.name.toLowerCase().includes(q) ||
        c.emails.some((e) => e.value.toLowerCase().includes(q)) ||
        c.tags.some((t) => t.toLowerCase().includes(q));

      const matchType = activeTypes.length === 0 || activeTypes.includes(c.relationType);

      return matchQ && matchType;
    });
  }, [allContacts, query, activeTypes]);

  function toggleType(type: RelationType) {
    setActiveTypes((prev) =>
      prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type]
    );
  }

  function toggleSelect(id: string) {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]
    );
  }

  const isEmpty = !isLoading && allContacts.length === 0;

  return (
    <AppShell>
      <div className="flex h-full flex-col">
        {/* Page topbar */}
        <div
          className="flex items-center justify-between border-b px-6 py-3"
          style={{ borderColor: "var(--border-subtle)", backgroundColor: "var(--surface-0)" }}
        >
          <div className="flex items-center gap-3">
            <h1 className="text-lg font-semibold" style={{ color: "var(--text-primary)" }}>
              Contacts
            </h1>
            <span
              className="rounded-full px-2 py-0.5 text-xs font-medium"
              style={{ backgroundColor: "var(--surface-3)", color: "var(--text-muted)" }}
            >
              {filtered.length}
            </span>
            {mode === "fallback" && (
              <span
                className="rounded-full px-2 py-0.5 text-xs font-medium"
                style={{ backgroundColor: "var(--surface-2)", color: "var(--text-muted)" }}
              >
                demo
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            {/* View toggle */}
            <div
              className="flex items-center rounded-md border"
              style={{ borderColor: "var(--border-subtle)" }}
            >
              <button
                onClick={() => setView("table")}
                className="flex h-7 w-7 items-center justify-center rounded-l-md transition-colors"
                style={{
                  backgroundColor: view === "table" ? "var(--surface-3)" : "transparent",
                  color: view === "table" ? "var(--text-primary)" : "var(--text-muted)",
                }}
                aria-label="Vue table"
              >
                <List size={14} />
              </button>
              <button
                onClick={() => setView("gallery")}
                className="flex h-7 w-7 items-center justify-center rounded-r-md transition-colors"
                style={{
                  backgroundColor: view === "gallery" ? "var(--surface-3)" : "transparent",
                  color: view === "gallery" ? "var(--text-primary)" : "var(--text-muted)",
                }}
                aria-label="Vue galerie"
              >
                <GridFour size={14} />
              </button>
            </div>

            <button
              className="flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors hover:bg-[var(--surface-2)]"
              style={{ borderColor: "var(--border-subtle)", color: "var(--text-muted)" }}
              title="Importer vCard / Google Contacts"
              onClick={() => alert("Import vCard/Google Contacts (à implémenter)")}
            >
              <UploadSimple size={13} />
              Importer
            </button>

            <Link
              href="/contacts/nouveau"
              className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-opacity hover:opacity-90"
              style={{ backgroundColor: "var(--accent)", color: "var(--accent-foreground)" }}
            >
              <Plus size={13} />
              Nouveau contact
            </Link>
          </div>
        </div>

        {/* Filters */}
        <div
          className="flex flex-wrap items-center gap-3 border-b px-6 py-2"
          style={{ borderColor: "var(--border-subtle)", backgroundColor: "var(--surface-0)" }}
        >
          {/* Search */}
          <div
            className="flex items-center gap-2 rounded-md border px-2 py-1"
            style={{ borderColor: "var(--border-subtle)", backgroundColor: "var(--surface-1)" }}
          >
            <MagnifyingGlass size={13} style={{ color: "var(--text-muted)" }} />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Rechercher…"
              className="bg-transparent text-sm outline-none"
              style={{ color: "var(--text-primary)", width: 180 }}
            />
            {query && (
              <button onClick={() => setQuery("")} aria-label="Effacer">
                <X size={12} style={{ color: "var(--text-muted)" }} />
              </button>
            )}
          </div>

          {/* Type chips */}
          <div className="flex flex-wrap gap-1.5">
            {ALL_RELATION_TYPES.map((type) => {
              const active = activeTypes.includes(type);
              return (
                <button
                  key={type}
                  onClick={() => toggleType(type)}
                  className="transition-opacity"
                  style={{ opacity: active ? 1 : 0.55 }}
                  aria-pressed={active}
                >
                  <RelationChip type={type} />
                </button>
              );
            })}
            {activeTypes.length > 0 && (
              <button
                onClick={() => setActiveTypes([])}
                className="flex items-center gap-1 rounded-full px-2 py-0.5 text-xs transition-colors hover:bg-[var(--surface-2)]"
                style={{ color: "var(--text-muted)" }}
              >
                <X size={10} />
                Tout
              </button>
            )}
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="grid gap-4 p-6 sm:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 6 }, (_, i) => <SkeletonCard key={i} />)}
            </div>
          ) : isEmpty ? (
            <EmptyState />
          ) : view === "table" ? (
            <ContactsTable
              contacts={filtered}
              onSelectionChange={setSelectedIds}
              orgNames={orgNames}
            />
          ) : (
            <ContactGallery
              contacts={filtered}
              selectedIds={selectedIds}
              onToggleSelect={toggleSelect}
              orgNames={orgNames}
            />
          )}
        </div>
      </div>

      <BulkActionBar
        selectedCount={selectedIds.length}
        onClear={() => setSelectedIds([])}
        onEmail={() => {
          const emails = allContacts
            .filter((c) => selectedIds.includes(c.id))
            .flatMap((c) => c.emails.map((e) => e.value))
            .join(",");
          window.open(`mailto:${emails}`);
        }}
        onArchive={() => setSelectedIds([])}
        onAddTag={() => alert("Ajout de tag (à implémenter)")}
      />
    </AppShell>
  );
}
