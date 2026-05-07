"use client";

import { AppShell } from "@/components/shell";
import {
  CONTACTS,
  INTERACTIONS,
  ORGANISATIONS,
  ContactAvatar,
  RelationChip,
  formatDate,
  isBirthdaySoon,
  relativeBirthday,
  entityToContact,
  entitiesToContacts,
} from "@/components/contacts";
import type { Contact, Interaction } from "@/components/contacts";
import {
  ArrowLeft,
  Buildings,
  Calendar,
  ArrowSquareOut,
  GithubLogo,
  LinkedinLogo,
  Envelope,
  Phone,
  TwitterLogo,
  Link as LinkIcon,
} from "@phosphor-icons/react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState, useCallback } from "react";
import { trpc } from "@/lib/trpc/client";
import type { RelationEdge } from "@supernote/ipc";

type Tab = "notes" | "timeline" | "liens" | "finance" | "activite";

// ── Small UI helpers ──────────────────────────────────────────────────────────

function InfoRow({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2.5 py-1.5">
      <span style={{ color: "var(--text-muted)", marginTop: 2, flexShrink: 0 }}>{icon}</span>
      <span className="text-sm" style={{ color: "var(--text-secondary)" }}>{children}</span>
    </div>
  );
}

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
        <button
          onClick={handleSave}
          disabled={updateMutation.isPending}
          className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-opacity hover:opacity-90 disabled:opacity-50"
          style={{ backgroundColor: "var(--accent)", color: "var(--accent-foreground)" }}
        >
          {updateMutation.isPending ? "Enregistrement…" : saved ? "Enregistre" : "Enregistrer"}
        </button>
      </div>
      <textarea
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
      return entitiesToContacts(trpcData.items)
        .filter((e) => {
          const f = trpcData.items.find((i) => i.id === e.id)?.fields;
          return f?.["participants"] === contactId || f?.["contactId"] === contactId;
        })
        .map((e) => ({
          id: e.id,
          contactId,
          date: e.lastInteractionDate ?? e.notes ?? "",
          kind: "note" as const,
          title: e.name,
          notes: e.notes,
        }));
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
        <button
          className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors hover:opacity-90"
          style={{ backgroundColor: "var(--accent)", color: "var(--accent-foreground)" }}
        >
          + Ajouter interaction
        </button>
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

  // Try to load via tRPC first; fall back to fixture.
  const { data: trpcEntity, isError: entityError } = trpc.entities.get.useQuery(
    { id },
    { retry: false },
  );

  const contact: Contact | undefined = (() => {
    if (!entityError && trpcEntity) {
      return entityToContact(trpcEntity);
    }
    return CONTACTS.find((c) => c.id === id);
  })();

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

  const org = ORGANISATIONS.find((o) => o.id === contact.organisationId);
  const fixtureInteractions = INTERACTIONS.filter((i) => i.contactId === id);
  const soon = isBirthdaySoon(contact.birthday);
  const relBirthday = relativeBirthday(contact.birthday);
  const filePath = trpcEntity?.filePath;

  const TABS: { id: Tab; label: string }[] = [
    { id: "notes", label: "Notes" },
    { id: "timeline", label: "Timeline" },
    { id: "liens", label: "Liens" },
    { id: "finance", label: "Finance" },
    { id: "activite", label: "Activité" },
  ];

  const primaryEmail = contact.emails[0];

  return (
    <AppShell>
      <div className="flex h-full flex-col overflow-hidden">
        {/* Back */}
        <div
          className="flex items-center gap-2 border-b px-6 py-3"
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
        </div>

        <div className="flex flex-1 overflow-hidden">
          {/* Left column */}
          <aside
            className="flex flex-col gap-4 overflow-y-auto border-r p-6"
            style={{ width: 320, minWidth: 320, borderColor: "var(--border-subtle)" }}
          >
            {/* Avatar + name */}
            <div className="flex flex-col items-center gap-3 text-center">
              <ContactAvatar name={contact.name} photoUrl={contact.photoUrl} size={88} />
              <div>
                <h1 className="text-xl font-semibold" style={{ color: "var(--text-primary)" }}>
                  {contact.name}
                </h1>
                <div className="mt-1.5 flex justify-center">
                  <RelationChip type={contact.relationType} />
                </div>
              </div>
            </div>

            {/* Action buttons */}
            <div className="flex gap-2 justify-center flex-wrap">
              {primaryEmail && (
                <a
                  href={`mailto:${primaryEmail.value}`}
                  className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors hover:opacity-90"
                  style={{ backgroundColor: "var(--accent)", color: "var(--accent-foreground)" }}
                >
                  <Envelope size={12} />
                  Email
                </a>
              )}
              {contact.phones[0] && (
                <a
                  href={`tel:${contact.phones[0].value}`}
                  className="flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors hover:bg-[var(--surface-2)]"
                  style={{ borderColor: "var(--border)", color: "var(--text-secondary)" }}
                >
                  <Phone size={12} />
                  Appeler
                </a>
              )}
              {org && (
                <a
                  href={org.website}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors hover:bg-[var(--surface-2)]"
                  style={{ borderColor: "var(--border)", color: "var(--text-secondary)" }}
                >
                  <Buildings size={12} />
                  Org
                </a>
              )}
            </div>

            <div className="border-t" style={{ borderColor: "var(--border-subtle)" }} />

            {/* Info rows */}
            <div>
              {contact.emails.map((email) => (
                <InfoRow key={email.value} icon={<Envelope size={14} />}>
                  <a href={`mailto:${email.value}`} className="hover:underline">
                    {email.value}
                  </a>{" "}
                  <span className="text-xs" style={{ color: "var(--text-muted)" }}>({email.label})</span>
                </InfoRow>
              ))}
              {contact.phones.map((phone) => (
                <InfoRow key={phone.value} icon={<Phone size={14} />}>
                  {phone.value}{" "}
                  <span className="text-xs" style={{ color: "var(--text-muted)" }}>({phone.label})</span>
                </InfoRow>
              ))}
              {org && (
                <InfoRow icon={<Buildings size={14} />}>
                  {org.website ? (
                    <a href={org.website} target="_blank" rel="noopener noreferrer" className="hover:underline flex items-center gap-1">
                      {org.name}
                      <ArrowSquareOut size={11} />
                    </a>
                  ) : (
                    org.name
                  )}
                  <span className="text-xs" style={{ color: "var(--text-muted)" }}> — {org.industry}</span>
                </InfoRow>
              )}
              {contact.birthday && (
                <InfoRow icon={<Calendar size={14} />}>
                  <span
                    style={soon ? { color: "oklch(0.55 0.20 28)", fontWeight: 600 } : undefined}
                  >
                    {formatDate(contact.birthday)}
                    {relBirthday && (
                      <span className="ml-1.5 text-xs" style={{ color: soon ? "oklch(0.55 0.20 28)" : "var(--text-muted)" }}>
                        ({relBirthday})
                      </span>
                    )}
                  </span>
                </InfoRow>
              )}
            </div>

            {/* Social */}
            {(contact.social.linkedin || contact.social.twitter || contact.social.github) && (
              <>
                <div className="border-t" style={{ borderColor: "var(--border-subtle)" }} />
                <div className="flex gap-2">
                  {contact.social.linkedin && (
                    <a
                      href={contact.social.linkedin}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex h-8 w-8 items-center justify-center rounded-md border transition-colors hover:bg-[var(--surface-2)]"
                      style={{ borderColor: "var(--border-subtle)", color: "var(--text-muted)" }}
                      aria-label="LinkedIn"
                    >
                      <LinkedinLogo size={15} />
                    </a>
                  )}
                  {contact.social.twitter && (
                    <a
                      href={contact.social.twitter}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex h-8 w-8 items-center justify-center rounded-md border transition-colors hover:bg-[var(--surface-2)]"
                      style={{ borderColor: "var(--border-subtle)", color: "var(--text-muted)" }}
                      aria-label="Twitter"
                    >
                      <TwitterLogo size={15} />
                    </a>
                  )}
                  {contact.social.github && (
                    <a
                      href={contact.social.github}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex h-8 w-8 items-center justify-center rounded-md border transition-colors hover:bg-[var(--surface-2)]"
                      style={{ borderColor: "var(--border-subtle)", color: "var(--text-muted)" }}
                      aria-label="GitHub"
                    >
                      <GithubLogo size={15} />
                    </a>
                  )}
                </div>
              </>
            )}

            {/* Tags */}
            {contact.tags.length > 0 && (
              <>
                <div className="border-t" style={{ borderColor: "var(--border-subtle)" }} />
                <div className="flex flex-wrap gap-1.5">
                  {contact.tags.map((tag) => (
                    <span
                      key={tag}
                      className="rounded-full px-2.5 py-1 text-xs"
                      style={{ backgroundColor: "var(--surface-3)", color: "var(--text-muted)" }}
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              </>
            )}
          </aside>

          {/* Right column */}
          <div className="flex flex-1 flex-col overflow-hidden">
            {/* Tabs */}
            <div
              className="flex border-b"
              style={{ borderColor: "var(--border-subtle)" }}
            >
              {TABS.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className="px-4 py-3 text-sm font-medium transition-colors"
                  style={{
                    color: tab === t.id ? "var(--accent)" : "var(--text-muted)",
                    borderBottom: tab === t.id ? "2px solid var(--accent)" : "2px solid transparent",
                    backgroundColor: "transparent",
                  }}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {/* Tab content */}
            <div className="flex-1 overflow-y-auto p-6">
              {tab === "notes" && (
                <NotesTab entityId={id} initialNotes={contact.notes} />
              )}

              {tab === "timeline" && (
                <TimelineTab contactId={id} fixtureInteractions={fixtureInteractions} />
              )}

              {tab === "liens" && (
                <LiensTab
                  contactId={id}
                  orgName={org?.name}
                  orgWebsite={org?.website}
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
