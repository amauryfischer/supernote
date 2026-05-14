"use client";

import { AppShell, useMobileTitle } from "@/components/shell";
import { useIsMobile } from "@/hooks/useIsMobile";
import {
  CONTACTS,
  INTERACTIONS,
  formatDate,
  entityToContact,
} from "@/components/contacts";
import type { Contact, Interaction } from "@/components/contacts";
import { EditableSidebar } from "@/components/contacts/EditableSidebar";
import type { EntitySummary } from "@supernote/ipc";
import {
  ArrowLeft,
  Buildings,
  ArrowSquareOut,
  Link as LinkIcon,
} from "@phosphor-icons/react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState, useCallback } from "react";
import { Button, TextArea } from "@heroui/react";
import { trpc } from "@/lib/trpc/client";
import type { RelationEdge, FieldValue } from "@supernote/ipc";
import { localStore } from "@/lib/local-store";

type Tab = "notes" | "timeline" | "liens" | "finance" | "activite";

// ── Small UI helpers ──────────────────────────────────────────────────────────

function InteractionKindBadge({ kind }: { kind: string }) {
  const map: Record<string, string> = {
    réunion: "oklch(0.88 0.10 260)",
    appel: "oklch(0.88 0.10 200)",
    email: "oklch(0.88 0.10 150)",
    déjeuner: "oklch(0.88 0.10 80)",
    message: "oklch(0.88 0.10 295)",
    note: "oklch(0.88 0.06 240)",
  };
  return (
    <span
      className="rounded-full px-2 py-0.5 text-xs font-medium"
      style={{ backgroundColor: map[kind] ?? "var(--surface-3)", color: "var(--text-secondary)" }}
    >
      {kind}
    </span>
  );
}

// ── Tab: Notes ────────────────────────────────────────────────────────────────

interface NotesTabProps {
  entityId: string;
  initialNotes: string;
}

function NotesTab({ entityId, initialNotes }: NotesTabProps) {
  const [notes, setNotes] = useState(initialNotes);
  const [saved, setSaved] = useState(false);

  const updateMutation = trpc.entities.update.useMutation({
    onSuccess: () => {
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    },
  });

  const handleSave = useCallback(() => {
    updateMutation.mutate({ id: entityId, body: notes });
  }, [entityId, notes, updateMutation]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
          Note de fiche
        </p>
        <Button
          onPress={handleSave}
          isDisabled={updateMutation.isPending}
          size="sm"
          className="px-3 text-xs font-medium"
          style={{ backgroundColor: "var(--accent)", color: "var(--accent-foreground)" }}
        >
          {updateMutation.isPending ? "Enregistrement…" : saved ? "Enregistré" : "Enregistrer"}
        </Button>
      </div>
      <TextArea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        rows={20}
        className="w-full resize-none rounded-lg border p-4 text-sm font-mono leading-relaxed outline-none transition-colors focus:border-[var(--accent)]"
        style={{
          borderColor: "var(--border-subtle)",
          backgroundColor: "var(--surface-1)",
          color: "var(--text-primary)",
        }}
        placeholder="Aucune note…"
      />
      <p className="text-xs" style={{ color: "var(--text-muted)" }}>
        Markdown pris en charge. {updateMutation.isError && (
          <span style={{ color: "var(--danger)" }}>Erreur d'enregistrement (mode dégradé).</span>
        )}
      </p>
    </div>
  );
}

// ── Tab: Timeline ─────────────────────────────────────────────────────────────

interface TimelineTabProps {
  contactId: string;
  fixtureInteractions: Interaction[];
}

function TimelineTab({ contactId, fixtureInteractions }: TimelineTabProps) {
  const { data: trpcData, isError } = trpc.entities.list.useQuery(
    { typeId: "interaction", limit: 200 },
    { retry: false },
  );

  const interactions: Interaction[] = (() => {
    if (!isError && trpcData?.items && trpcData.items.length > 0) {
      return trpcData.items
        .filter((e: EntitySummary) => {
          const f = e.fields;
          return f["participants"] === contactId || f["contactId"] === contactId;
        })
        .map((e: EntitySummary) => {
          const f = e.fields;
          const titleVal = f["title"] ?? f["name"] ?? f["subject"];
          return {
            id: e.id,
            contactId,
            date: typeof f["date"] === "string" ? f["date"] : e.updatedAt,
            kind: (typeof f["kind"] === "string" ? f["kind"] : "note") as Interaction["kind"],
            title: typeof titleVal === "string" ? titleVal : e.typeName,
            notes: typeof f["notes"] === "string" ? f["notes"] : undefined,
          };
        });
    }
    return fixtureInteractions;
  })();

  const sorted = [...interactions].sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
          {sorted.length} interaction{sorted.length > 1 ? "s" : ""}
        </p>
        <Button
          size="sm"
          className="px-3 text-xs font-medium"
          style={{ backgroundColor: "var(--accent)", color: "var(--accent-foreground)" }}
        >
          + Ajouter interaction
        </Button>
      </div>

      {sorted.length === 0 && (
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>Aucune interaction enregistrée.</p>
      )}

      <div className="relative">
        <div
          className="absolute left-3 top-2 bottom-2 w-px"
          style={{ backgroundColor: "var(--border-subtle)" }}
        />
        <div className="flex flex-col gap-4">
          {sorted.map((interaction) => (
            <div key={interaction.id} className="flex gap-4">
              <div
                className="mt-1 h-6 w-6 flex-shrink-0 rounded-full border-2 flex items-center justify-center z-10"
                style={{ borderColor: "var(--accent)", backgroundColor: "var(--surface-0)" }}
              />
              <div
                className="flex-1 rounded-lg border p-4"
                style={{ borderColor: "var(--border-subtle)", backgroundColor: "var(--surface-1)" }}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <InteractionKindBadge kind={interaction.kind} />
                    <span className="font-medium text-sm" style={{ color: "var(--text-primary)" }}>
                      {interaction.title}
                    </span>
                  </div>
                  <span className="text-xs flex-shrink-0" style={{ color: "var(--text-muted)" }}>
                    {formatDate(interaction.date)}
                  </span>
                </div>
                {interaction.notes && (
                  <p className="mt-2 text-sm leading-relaxed" style={{ color: "var(--text-secondary)" }}>
                    {interaction.notes}
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Tab: Liens ────────────────────────────────────────────────────────────────

interface LiensTabProps {
  contactId: string;
  orgName?: string;
  orgWebsite?: string;
}

function LiensTab({ contactId, orgName, orgWebsite }: LiensTabProps) {
  const { data: relations, isError } = trpc.relations.listForEntity.useQuery(
    { entityId: contactId },
    { retry: false },
  );

  const liveRelations: RelationEdge[] = !isError && relations ? relations : [];

  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs font-medium uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
        Relations
      </p>
      <div
        className="flex flex-col gap-2 rounded-lg border p-4"
        style={{ borderColor: "var(--border-subtle)", backgroundColor: "var(--surface-1)" }}
      >
        {orgName && (
          <div className="flex items-center gap-2 text-sm">
            <Buildings size={14} style={{ color: "var(--text-muted)" }} />
            <span style={{ color: "var(--text-muted)" }}>Travaille chez</span>
            {orgWebsite ? (
              <a
                href={orgWebsite}
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium hover:underline flex items-center gap-1"
                style={{ color: "var(--text-primary)" }}
              >
                {orgName}
                <ArrowSquareOut size={11} />
              </a>
            ) : (
              <span className="font-medium" style={{ color: "var(--text-primary)" }}>{orgName}</span>
            )}
          </div>
        )}

        {liveRelations.length > 0 ? (
          liveRelations.map((rel) => (
            <div key={rel.id} className="flex items-center gap-2 text-sm">
              <LinkIcon size={14} style={{ color: "var(--text-muted)" }} />
              <span style={{ color: "var(--text-muted)" }}>{rel.relationTypeName}</span>
              <span className="font-medium" style={{ color: "var(--text-primary)" }}>
                {rel.sourceId === contactId ? rel.targetId : rel.sourceId}
              </span>
            </div>
          ))
        ) : (
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            {isError ? "Graphe de relations (mode dégradé — IPC non disponible)." : "Aucune relation liée."}
          </p>
        )}
      </div>
    </div>
  );
}

// ── Tab: Finance ──────────────────────────────────────────────────────────────

function FinanceTab({ contactId }: { contactId: string }) {
  const { data: trpcData, isError } = trpc.entities.list.useQuery(
    { typeId: "account", limit: 100 },
    { retry: false },
  );

  const accounts = !isError && trpcData
    ? trpcData.items.filter((e) => e.fields["holderId"] === contactId || e.fields["holder"] === contactId)
    : [];

  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs font-medium uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
        Finance
      </p>
      <div
        className="rounded-lg border p-8 text-center"
        style={{ borderColor: "var(--border-subtle)", borderStyle: "dashed" }}
      >
        {accounts.length > 0 ? (
          <ul className="text-sm text-left" style={{ color: "var(--text-secondary)" }}>
            {accounts.map((acc) => (
              <li key={acc.id}>{String(acc.fields["name"] ?? acc.id)}</li>
            ))}
          </ul>
        ) : (
          <>
            <p className="text-sm" style={{ color: "var(--text-muted)" }}>
              Aucun compte ou actif lié à ce contact.
            </p>
            <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
              Lier un Account ou Asset depuis le module Finance.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

// ── Tab: Activité ─────────────────────────────────────────────────────────────

interface ActiviteTabProps {
  filePath?: string;
}

function ActiviteTab({ filePath }: ActiviteTabProps) {
  const { data: history, isError } = trpc.git.history.useQuery(
    { filePath: filePath ?? "" },
    { enabled: Boolean(filePath), retry: false },
  );

  const logs = !isError && history
    ? history.map((h) => ({ text: h.message, date: h.isoDate }))
    : [
        { text: "Fiche créée", date: "2024-01-15" },
        { text: "Note mise à jour", date: "2026-03-10" },
        { text: "Tag ajouté : vip", date: "2026-04-01" },
      ];

  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs font-medium uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
        Logs d'activité
      </p>
      <div className="flex flex-col gap-2">
        {logs.map((log, i) => (
          <div key={i} className="flex items-center justify-between text-sm">
            <span style={{ color: "var(--text-secondary)" }}>{log.text}</span>
            <span className="text-xs" style={{ color: "var(--text-muted)" }}>
              {log.date ? formatDate(log.date) : "—"}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Main page component ───────────────────────────────────────────────────────

export default function ContactDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [tab, setTab] = useState<Tab>("notes");
  const isMobile = useIsMobile();

  // Try to load via tRPC first; fall back to fixture / localStore.
  const { data: trpcEntity, isError: entityError } = trpc.entities.get.useQuery(
    { id },
    { retry: false },
  );

  const hasLiveBackend = !entityError && Boolean(trpcEntity);

  const contact: Contact | undefined = (() => {
    if (!entityError && trpcEntity) {
      return entityToContact(trpcEntity);
    }
    const fixture = CONTACTS.find((c) => c.id === id);
    if (fixture) return fixture;
    const local = localStore.get(id);
    if (local) {
      return entityToContact({
        id: local.id,
        typeId: local.typeId,
        typeName: String(local.fields["name"] ?? ""),
        fields: local.fields as Record<string, FieldValue>,
        tags: local.tags ?? [],
        body: local.body ?? "",
        filePath: "",
        createdAt: local.createdAt,
        updatedAt: local.updatedAt,
      });
    }
    return undefined;
  })();

  // Resolve the linked organisation entity (real worker data — replaces
  // the previous fixture lookup). The query is enabled only when the
  // contact carries a real id; legacy fixture-shaped ids (e.g. `org-1`)
  // produce a benign 404 and the Liens tab shows nothing for that row.
  const orgIdField = contact?.organisationId;
  const { data: orgEntity } = trpc.entities.get.useQuery(
    { id: orgIdField ?? "" },
    { enabled: !!orgIdField, retry: false },
  );

  if (!contact) {
    return (
      <AppShell>
        <div className="flex h-full items-center justify-center">
          <div className="text-center">
            <p className="text-sm" style={{ color: "var(--text-muted)" }}>Contact introuvable.</p>
            <Link href="/contacts" className="mt-2 text-sm underline" style={{ color: "var(--accent)" }}>
              Retour aux contacts
            </Link>
          </div>
        </div>
      </AppShell>
    );
  }

  const orgName = (() => {
    if (!orgEntity) return undefined;
    const raw = orgEntity.fields["name"];
    return typeof raw === "string" && raw.trim().length > 0 ? raw.trim() : undefined;
  })();
  const orgWebsite =
    typeof orgEntity?.fields["website"] === "string"
      ? (orgEntity.fields["website"] as string)
      : undefined;
  const fixtureInteractions = INTERACTIONS.filter((i) => i.contactId === id);
  const filePath = trpcEntity?.filePath;

  const TABS: { id: Tab; label: string }[] = [
    { id: "notes", label: "Notes" },
    { id: "timeline", label: "Timeline" },
    { id: "liens", label: "Liens" },
    { id: "finance", label: "Finance" },
    { id: "activite", label: "Activité" },
  ];

  // Mobile chrome — publish contact name as title; hide desktop breadcrumb + sidebar.
  useMobileTitle(isMobile ? contact.name : null);

  return (
    <AppShell>
      <div className="flex h-full flex-col overflow-hidden">
        {/* Back + name + aliases breadcrumb — hidden on mobile (title is in shell top bar) */}
        <div
          className="hidden items-center gap-3 border-b px-6 py-3 md:flex"
          style={{ borderColor: "var(--border-subtle)" }}
        >
          <Link
            href="/contacts"
            className="flex items-center gap-1.5 text-sm transition-colors hover:underline"
            style={{ color: "var(--text-muted)" }}
          >
            <ArrowLeft size={14} />
            Contacts
          </Link>
          {contact.aliases.length > 0 && (
            <div className="flex items-center gap-1.5 overflow-hidden">
              <span className="text-sm" style={{ color: "var(--text-muted)" }}>·</span>
              <span
                className="truncate text-sm font-medium"
                style={{ color: "var(--text-primary)" }}
              >
                {contact.name}
              </span>
              <span className="text-sm" style={{ color: "var(--text-muted)" }}>·</span>
              <div className="flex flex-wrap gap-1">
                {contact.aliases.map((alias) => (
                  <span
                    key={alias}
                    className="rounded-full px-2 py-0.5 text-[10px] font-medium"
                    style={{
                      backgroundColor:
                        "color-mix(in oklch, var(--accent) 14%, var(--surface-3))",
                      color: "var(--text-secondary)",
                    }}
                    title={`Alias: ${alias}`}
                  >
                    {alias}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="flex flex-1 overflow-hidden">
          {/* Left column — editable sidebar — hidden on mobile (full-width detail only) */}
          {!isMobile && <EditableSidebar contact={contact} hasLiveBackend={hasLiveBackend} />}

          {/* Right column */}
          <div className="flex flex-1 flex-col overflow-hidden">
            {/* Tabs */}
            <div
              className="flex border-b"
              style={{ borderColor: "var(--border-subtle)" }}
            >
              {TABS.map((t) => (
                <Button
                  key={t.id}
                  variant="ghost"
                  size="sm"
                  onPress={() => setTab(t.id)}
                  className="rounded-none px-4 py-3 text-sm font-medium"
                  style={{
                    color: tab === t.id ? "var(--accent)" : "var(--text-muted)",
                    borderBottom: tab === t.id ? "2px solid var(--accent)" : "2px solid transparent",
                  }}
                >
                  {t.label}
                </Button>
              ))}
            </div>

            {/* Tab content */}
            <div className="flex-1 overflow-y-auto p-3 md:p-6">
              {tab === "notes" && (
                <NotesTab entityId={id} initialNotes={contact.notes} />
              )}

              {tab === "timeline" && (
                <TimelineTab contactId={id} fixtureInteractions={fixtureInteractions} />
              )}

              {tab === "liens" && (
                <LiensTab
                  contactId={id}
                  orgName={orgName}
                  orgWebsite={orgWebsite}
                />
              )}

              {tab === "finance" && (
                <FinanceTab contactId={id} />
              )}

              {tab === "activite" && (
                <ActiviteTab filePath={filePath} />
              )}
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
