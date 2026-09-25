"use client";

import { AppShell, useMobileTitle } from "@/components/shell";
import { useIsMobile } from "@/hooks/useIsMobile";
import {
  CONTACTS,
  formatDate,
  entityToContact,
} from "@/components/contacts";
import type { Contact } from "@/components/contacts";
import { DossierTab } from "@/components/contacts/DossierTab";
import { EditableSidebar } from "@/components/contacts/EditableSidebar";
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
import { Skeleton } from "@supernote/ui";
import { trpc } from "@/lib/trpc/client";
import type { RelationEdge, FieldValue } from "@supernote/ipc";
import { localStore } from "@/lib/local-store";
import { useSettings } from "@/components/settings/SettingsContext";
import { ContactEmailTimeline } from "@/components/contacts/ContactEmailTimeline";

type Tab = "dossier" | "notes" | "emails" | "liens" | "finance" | "activite";

// ── Small UI helpers ──────────────────────────────────────────────────────────

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
        <p className="sn-eyebrow">
          Note de fiche
        </p>
        <Button
          onPress={handleSave}
          isDisabled={updateMutation.isPending}
          size="sm"
          className="px-3 text-xs font-medium"
          style={{ backgroundColor: "var(--btn-primary-bg)", color: "var(--btn-primary-fg)" }}
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

// ── Tab: Liens ────────────────────────────────────────────────────────────────

interface LiensTabProps {
  contactId: string;
  orgId?: string;
  orgName?: string;
  orgWebsite?: string;
}

function LiensTab({ contactId, orgId, orgName, orgWebsite }: LiensTabProps) {
  const { data: relations, isError } = trpc.relations.listForEntity.useQuery(
    { entityId: contactId },
    { retry: false },
  );

  const liveRelations: RelationEdge[] = !isError && relations ? relations : [];

  return (
    <div className="flex flex-col gap-4">
      <p className="sn-eyebrow">
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
            {orgId ? (
              <Link href={`/contacts/${orgId}`} className="font-medium hover:underline" style={{ color: "var(--text-primary)" }}>
                {orgName}
              </Link>
            ) : (
              <span className="font-medium" style={{ color: "var(--text-primary)" }}>{orgName}</span>
            )}
            {orgWebsite && (
              <a
                href={orgWebsite}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`Site de ${orgName}`}
                className="flex items-center"
                style={{ color: "var(--text-muted)" }}
              >
                <ArrowSquareOut size={11} />
              </a>
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
      <p className="sn-eyebrow">
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
  const { data: history, isError, isLoading } = trpc.git.history.useQuery(
    { filePath: filePath ?? "" },
    { enabled: Boolean(filePath), retry: false },
  );

  // JAMAIS de logs fabriqués en fallback : l'activité vient de l'historique git
  // réel de la fiche. En erreur / absence, on le DIT — inventer des entrées
  // datées présentées comme vraies trahit la confiance de l'utilisateur.
  const logs = (!isError && history ? history : []).map((h) => ({
    text: h.message,
    date: h.isoDate,
  }));

  return (
    <div className="flex flex-col gap-4">
      <p className="sn-eyebrow">
        Logs d'activité
      </p>
      {isLoading ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="flex items-center justify-between">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-3 w-16" />
            </div>
          ))}
        </div>
      ) : logs.length === 0 ? (
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>
          {!filePath || isError
            ? "Historique d'activité indisponible pour cette fiche."
            : "Aucune activité enregistrée pour l'instant."}
        </p>
      ) : (
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
      )}
    </div>
  );
}

// ── Main page component ───────────────────────────────────────────────────────

export default function ContactDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [tab, setTab] = useState<Tab>("dossier");
  const isMobile = useIsMobile();
  const { settings } = useSettings();

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

  // Call ALL hooks BEFORE the conditional early return below. Moving this
  // after the `if (!contact)` branch made the hook count differ between the
  // loading render (contact === undefined → early return, hook never called)
  // and the loaded render (contact resolved → hook fires) → React errored
  // with "Rendered more hooks than during the previous render".
  useMobileTitle(isMobile && contact ? contact.name : null);

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
  const filePath = trpcEntity?.filePath;

  const TABS: { id: Tab; label: string }[] = [
    { id: "dossier", label: "Dossier" },
    { id: "notes", label: "Notes" },
    { id: "emails", label: "Emails" },
    { id: "liens", label: "Liens" },
    { id: "finance", label: "Finance" },
    { id: "activite", label: "Activité" },
  ];

  // Mobile chrome publication moved BEFORE the `if (!contact)` early return
  // above so React always sees the same hook order across renders.

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
            {/* Tabs — scrollables : 6 onglets ne tiennent pas en 360px */}
            <div
              className="scroll-x-clean flex overflow-x-auto border-b"
              style={{ borderColor: "var(--border-subtle)" }}
            >
              {TABS.map((t) => (
                <Button
                  key={t.id}
                  variant="ghost"
                  size="sm"
                  onPress={() => setTab(t.id)}
                  className="shrink-0 rounded-none px-4 py-3 text-sm font-medium"
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

              {tab === "dossier" &&
                (trpcEntity ? (
                  <DossierTab
                    entity={{ id: trpcEntity.id, typeId: trpcEntity.typeId, fields: trpcEntity.fields as Record<string, unknown> }}
                    name={contact.name}
                  />
                ) : (
                  <p className="text-sm" style={{ color: "var(--text-muted)" }}>
                    Le dossier se construit depuis un coffre ouvert.
                  </p>
                ))}

              {tab === "emails" && (
                <ContactEmailTimeline
                  clientId={settings.googleDrive.clientId}
                  emails={contact.emails.map((e) => e.value).filter(Boolean)}
                  selfEmail={settings.gmail.connectedEmail}
                />
              )}

              {tab === "liens" && (
                <LiensTab
                  contactId={id}
                  orgId={orgIdField}
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
