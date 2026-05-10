"use client";

import { AppShell } from "@/components/shell";
import {
  BulkActionBar,
  ContactGallery,
  ContactsTable,
  ALL_RELATION_TYPES,
  RelationChip,
  useContactsSource,
} from "@/components/contacts";
import type { RelationType, Contact } from "@/components/contacts";
import { GridFour, List, Plus, MagnifyingGlass, X, UploadSimple } from "@phosphor-icons/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useMemo, useEffect } from "react";
import { SkeletonCard } from "@supernote/ui";
import { useTranslations } from "next-intl";
import { trpc } from "@/lib/trpc/client";
import { usePrompt, useConfirm } from "@/hooks/usePrompt";

type ViewMode = "table" | "gallery";

// ── Inline parsers (no deps) ────────────────────────────────────────────────

interface ParsedContact {
  name: string;
  email?: string;
  phone?: string;
  notes?: string;
}

/** Minimal vCard 2.1/3.0/4.0 parser: extracts FN, EMAIL, TEL, NOTE per VCARD block. */
function parseVCard(text: string): ParsedContact[] {
  const out: ParsedContact[] = [];
  const blocks = text.split(/BEGIN:VCARD/i).slice(1);
  for (const raw of blocks) {
    const block = raw.split(/END:VCARD/i)[0] ?? "";
    const lines = block.replace(/\r\n[ \t]/g, "").split(/\r?\n/);
    const c: ParsedContact = { name: "" };
    for (const line of lines) {
      const m = /^([A-Z0-9-]+)(;[^:]*)?:(.*)$/i.exec(line.trim());
      if (!m) continue;
      const key = m[1]!.toUpperCase();
      const val = m[3]!;
      if (key === "FN" && !c.name) c.name = val;
      else if (key === "N" && !c.name) c.name = val.split(";").filter(Boolean).reverse().join(" ").trim();
      else if (key === "EMAIL" && !c.email) c.email = val;
      else if (key === "TEL" && !c.phone) c.phone = val;
      else if (key === "NOTE" && !c.notes) c.notes = val;
    }
    if (c.name) out.push(c);
  }
  return out;
}

/** Minimal CSV parser: comma-separated, header row. Recognized columns: name, email, phone, note(s). */
function parseCsv(text: string): ParsedContact[] {
  const rows = text.split(/\r?\n/).filter((r) => r.trim().length > 0);
  if (rows.length < 2) return [];
  const split = (line: string): string[] =>
    line.match(/(".*?"|[^,]+)/g)?.map((c) => c.replace(/^"|"$/g, "").trim()) ?? [];
  const headers = split(rows[0]!).map((h) => h.toLowerCase());
  const idx = (k: string) => headers.findIndex((h) => h === k || h.includes(k));
  const ni = idx("name"), ei = idx("email"), pi = idx("phone"), no = idx("note");
  const out: ParsedContact[] = [];
  for (let i = 1; i < rows.length; i++) {
    const cells = split(rows[i]!);
    const name = ni >= 0 ? cells[ni] ?? "" : cells[0] ?? "";
    if (!name) continue;
    out.push({
      name,
      email: ei >= 0 ? cells[ei] : undefined,
      phone: pi >= 0 ? cells[pi] : undefined,
      notes: no >= 0 ? cells[no] : undefined,
    });
  }
  return out;
}

/** Empty state shown when there are truly no contacts at all. */
function EmptyState() {
  const t = useTranslations("contacts");

  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 py-24 text-center">
      <p className="text-base font-medium" style={{ color: "var(--text-secondary)" }}>
        {t("noContacts")}
      </p>
      <p className="text-sm" style={{ color: "var(--text-muted)" }}>
        {t("importHint")}
      </p>
      <Link
        href="/contacts/nouveau"
        prefetch={true}
        className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-opacity hover:opacity-90"
        style={{ backgroundColor: "var(--accent)", color: "var(--accent-foreground)" }}
      >
        <Plus size={13} />
        {t("newContact")}
      </Link>
    </div>
  );
}

export default function ContactsPage() {
  const router = useRouter();
  const t = useTranslations("contacts");
  const tCommon = useTranslations("common");
  const [view, setView] = useState<ViewMode>("table");
  const [query, setQuery] = useState("");
  const [activeTypes, setActiveTypes] = useState<RelationType[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  // Resolves contacts from tRPC (vault Web Worker in PWA mode).
  const { contacts: allContacts, mode, isLoading } = useContactsSource();
  const prompt = usePrompt();
  const confirm = useConfirm();

  // Hidden file input + tRPC mutations for import / bulk actions.
  const fileInputRef = useRef<HTMLInputElement>(null);
  const utils = trpc.useUtils();
  const createMutation = trpc.entities.create.useMutation({
    onSuccess: () => {
      void utils.entities.list.invalidate({ typeId: "personne" });
    },
  });
  const updateMutation = trpc.entities.update.useMutation({
    onSuccess: () => {
      void utils.entities.list.invalidate({ typeId: "personne" });
    },
  });
  const deleteMutation = trpc.entities.delete.useMutation({
    onSuccess: () => {
      void utils.entities.list.invalidate({ typeId: "personne" });
    },
  });

  const handleImportClick = () => fileInputRef.current?.click();

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting same file
    if (!file) return;
    const text = await file.text();
    const isVcf = /\.vcf$/i.test(file.name) || /BEGIN:VCARD/i.test(text);
    const isCsv = /\.csv$/i.test(file.name) || /[,;]/.test(text.split(/\r?\n/)[0] ?? "");
    let parsed: ParsedContact[] = [];
    if (isVcf) parsed = parseVCard(text);
    else if (isCsv) parsed = parseCsv(text);
    if (parsed.length === 0) {
      console.warn("[contacts.import] Format de fichier non reconnu ou aucun contact trouvé");
      return;
    }
    for (const p of parsed) {
      const fields: Record<string, unknown> = {
        name: p.name,
        emails: p.email ? JSON.stringify([{ value: p.email, label: "perso" }]) : "[]",
        phones: p.phone ? JSON.stringify([{ value: p.phone, label: "mobile" }]) : "[]",
        relationType: "connaissance",
        notes: p.notes ?? "",
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      try { await createMutation.mutateAsync({ typeId: "personne", fields: fields as any }); } catch { /* no-op */ }
    }
  };

  const handleBulkAddTag = async () => {
    const tag = await prompt("Nom du tag à ajouter aux contacts sélectionnés ?", {
      placeholder: "ami, collègue, …",
    });
    if (!tag || !tag.trim()) return;
    const newTag = tag.trim();
    for (const id of selectedIds) {
      const c = allContacts.find((x) => x.id === id);
      if (!c) continue;
      const tags = Array.from(new Set([...(c.tags ?? []), newTag]));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      try { await updateMutation.mutateAsync({ id, tags } as any); } catch { /* no-op */ }
    }
    setSelectedIds([]);
  };

  const handleBulkDelete = async () => {
    const ok = await confirm({
      title: `Supprimer ${selectedIds.length} contact(s) ?`,
      description: "Cette action déplace les contacts sélectionnés dans la corbeille.",
      destructive: true,
      confirmLabel: "Supprimer",
    });
    if (!ok) return;
    for (const id of selectedIds) {
      try { await deleteMutation.mutateAsync({ id }); } catch { /* no-op */ }
    }
    setSelectedIds([]);
  };

  // Warm the route bundle so the "Nouveau contact" CTA navigates instantly,
  // even when Next.js dev hasn't compiled /contacts/nouveau yet (Link prefetch
  // is best-effort in dev).
  useEffect(() => {
    router.prefetch("/contacts/nouveau");
  }, [router]);

  // Org names map — built from real `organisation` entities so the table /
  // gallery columns display the org's name instead of its raw ULID. Legacy
  // contacts that still reference a fixture-shaped id (e.g. "org-1") simply
  // miss the lookup and the column renders the placeholder dash.
  const organisationListQuery = trpc.entities.list.useQuery(
    { typeId: "organisation", limit: 500 },
    { staleTime: 30_000 },
  );
  const orgNames = useMemo<Map<string, string>>(() => {
    const m = new Map<string, string>();
    const items = organisationListQuery.data?.items ?? [];
    for (const e of items) {
      const raw = e.fields["name"];
      const name = typeof raw === "string" && raw.trim().length > 0 ? raw.trim() : "Sans nom";
      m.set(e.id, name);
    }
    return m;
  }, [organisationListQuery.data]);

  const filtered = useMemo<Contact[]>(() => {
    const q = query.trim().toLowerCase();
    return allContacts.filter((c) => {
      const matchQ =
        q.length === 0 ||
        c.name.toLowerCase().includes(q) ||
        // Aliases were absent from the haystack — typing a contact's
        // nickname (e.g. "LD" for "Linh Dan") returned zero results even
        // though the contact picker (which goes through MiniSearch on the
        // worker) handles aliases just fine.
        (c.aliases ?? []).some((a) => a.toLowerCase().includes(q)) ||
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
              {t("title")}
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
                aria-label={t("tableView")}
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
                aria-label={t("galleryView")}
              >
                <GridFour size={14} />
              </button>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept=".vcf,.csv,text/vcard,text/csv"
              className="hidden"
              onChange={handleImportFile}
            />
            <button
              className="flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors hover:bg-[var(--surface-2)]"
              style={{ borderColor: "var(--border-subtle)", color: "var(--text-muted)" }}
              title={t("importHint")}
              onClick={handleImportClick}
            >
              <UploadSimple size={13} />
              {t("importLabel")}
            </button>

            <Link
              href="/contacts/nouveau"
              prefetch={true}
              className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-opacity hover:opacity-90"
              style={{ backgroundColor: "var(--accent)", color: "var(--accent-foreground)" }}
            >
              <Plus size={13} />
              {t("newContact")}
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
              placeholder={tCommon("search")}
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
                {t("clearFilter")}
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
        onArchive={handleBulkDelete}
        archiveLabel="Supprimer"
        onAddTag={handleBulkAddTag}
      />
    </AppShell>
  );
}
