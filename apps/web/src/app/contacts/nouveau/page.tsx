"use client";

import { AppShell } from "@/components/shell";
import {
  ALL_RELATION_TYPES,
  RelationChip,
  ContactAvatar,
  OrganisationSelector,
  contactFormToEntityFields,
} from "@/components/contacts";
import type { RelationType } from "@/components/contacts";
import { ArrowLeft, LinkedinLogo, TwitterLogo, GithubLogo, Plus, X, UploadSimple } from "@phosphor-icons/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useRef, useEffect } from "react";
import { trpc } from "@/lib/trpc/client";
import { TagSelector } from "@/components/tags/TagSelector";

interface EmailEntry { value: string; label: "pro" | "perso" | "autre" }
interface PhoneEntry { value: string; label: "mobile" | "fixe" | "pro" }

function FieldLabel({ children, required }: { children: React.ReactNode; required?: boolean }) {
  return (
    <label className="block text-xs font-medium mb-1" style={{ color: "var(--text-secondary)" }}>
      {children}
      {required && <span style={{ color: "var(--danger)" }}> *</span>}
    </label>
  );
}

function TextInput({ value, onChange, placeholder, type = "text" }: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full rounded-md border px-3 py-2 text-sm outline-none transition-colors focus:border-[var(--accent)]"
      style={{ borderColor: "var(--border-subtle)", backgroundColor: "var(--surface-1)", color: "var(--text-primary)" }}
    />
  );
}

export default function NouveauContactPage() {
  const router = useRouter();

  const [name, setName] = useState("");
  const [photoPreview, setPhotoPreview] = useState<string | undefined>();
  const [emails, setEmails] = useState<EmailEntry[]>([{ value: "", label: "perso" }]);
  const [phones, setPhones] = useState<PhoneEntry[]>([{ value: "", label: "mobile" }]);
  const [birthday, setBirthday] = useState("");
  const [orgId, setOrgId] = useState<string | undefined>(undefined);
  // Default to no preselected relation. Auto-selecting "connaissance" looked
  // like the user had already made a choice and confused QA. Only highlight
  // a chip when the user explicitly clicks one.
  const [relationType, setRelationType] = useState<RelationType | "">("");
  const [linkedin, setLinkedin] = useState("");
  const [twitter, setTwitter] = useState("");
  const [github, setGithub] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [notes, setNotes] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const fileRef = useRef<HTMLInputElement>(null);

  const utils = trpc.useUtils();
  const createMutation = trpc.entities.create.useMutation({
    onSuccess: async (entity) => {
      // Force the contacts list query to re-execute so the new entry shows
      // up immediately when the user navigates back to /contacts (without
      // requiring a hard reload). `invalidate` only marks the cache stale —
      // if `refetchOnMount: false` or staleTime is set, the consumer keeps
      // showing the old cached value. `refetch` runs the query right now.
      await utils.entities.list.refetch({ typeId: "personne", limit: 500 });
      await utils.entities.search.invalidate();
      router.push(`/contacts/${entity.id}`);
    },
  });

  function handlePhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    setPhotoPreview(url);
  }

  function addEmail() { setEmails((prev) => [...prev, { value: "", label: "perso" }]); }
  function removeEmail(i: number) { setEmails((prev) => prev.filter((_, idx) => idx !== i)); }
  function updateEmail(i: number, field: keyof EmailEntry, val: string) {
    setEmails((prev) => prev.map((e, idx) => idx === i ? { ...e, [field]: val } : e));
  }

  function addPhone() { setPhones((prev) => [...prev, { value: "", label: "mobile" }]); }
  function removePhone(i: number) { setPhones((prev) => prev.filter((_, idx) => idx !== i)); }
  function updatePhone(i: number, field: keyof PhoneEntry, val: string) {
    setPhones((prev) => prev.map((p, idx) => idx === i ? { ...p, [field]: val } : p));
  }

  function removeTag(t: string) { setTags((prev) => prev.filter((x) => x !== t)); }

  function validate(): boolean {
    const errs: Record<string, string> = {};
    if (!name.trim()) errs["name"] = "Le nom est requis.";
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  // Ctrl+Enter / Cmd+Enter submits the form from anywhere on the page,
  // EXCEPT inside a textarea where the user may legitimately want to
  // insert a newline (notes field). The listener is bound to `document`
  // so it fires regardless of which input is focused.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Enter" || (!e.metaKey && !e.ctrlKey)) return;
      const target = e.target as HTMLElement | null;
      if (target?.tagName === "TEXTAREA") return;
      if (createMutation.isPending) return;
      e.preventDefault();
      // Synthesize a minimal FormEvent — handleSubmit only uses preventDefault.
      handleSubmit({ preventDefault: () => {} } as React.FormEvent);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;

    const fields = contactFormToEntityFields({
      name,
      emails: emails.filter((em) => em.value.trim()),
      phones: phones.filter((ph) => ph.value.trim()),
      birthday: birthday || undefined,
      organisationId: orgId,
      // Persist a sensible default if the user never picked a chip.
      relationType: (relationType || "connaissance") as RelationType,
      linkedin: linkedin || undefined,
      twitter: twitter || undefined,
      github: github || undefined,
      tags,
      notes,
    });

    createMutation.mutate({
      typeId: "personne",
      fields,
      body: notes,
      tags,
    });
  }

  return (
    <AppShell>
      {/* Full-screen feedback overlay while the create mutation is in flight.
          Without this, the user sees a frozen "Créer" button for the worker
          round-trip and assumes nothing happened. */}
      {createMutation.isPending && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ backgroundColor: "color-mix(in oklch, var(--surface-0) 70%, transparent)" }}
          aria-live="polite"
          aria-busy="true"
        >
          <div
            className="flex items-center gap-3 rounded-lg border px-5 py-3 shadow-lg"
            style={{ borderColor: "var(--border-subtle)", backgroundColor: "var(--surface-1)" }}
          >
            <div
              className="h-4 w-4 animate-spin rounded-full border-2 border-transparent"
              style={{ borderTopColor: "var(--accent)", borderRightColor: "var(--accent)" }}
            />
            <span className="text-sm" style={{ color: "var(--text-secondary)" }}>
              Création en cours…
            </span>
          </div>
        </div>
      )}
      <div className="mx-auto max-w-2xl px-6 py-8">
        {/* Back */}
        <Link
          href="/contacts"
          prefetch={true}
          className="mb-6 flex items-center gap-1.5 text-sm transition-colors hover:underline"
          style={{ color: "var(--text-muted)" }}
        >
          <ArrowLeft size={14} />
          Contacts
        </Link>

        <h1 className="mb-6 text-xl font-semibold" style={{ color: "var(--text-primary)" }}>
          Nouveau contact
        </h1>

        <form onSubmit={handleSubmit} className="flex flex-col gap-6">
          {/* Photo + Nom */}
          <div className="flex items-start gap-4">
            <div className="flex flex-col items-center gap-2">
              <ContactAvatar name={name || "?"} photoUrl={photoPreview} size={72} />
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs transition-colors hover:bg-[var(--surface-2)]"
                style={{ borderColor: "var(--border-subtle)", color: "var(--text-muted)" }}
              >
                <UploadSimple size={11} />
                Photo
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handlePhotoChange}
              />
            </div>
            <div className="flex-1">
              <FieldLabel required>Nom complet</FieldLabel>
              <TextInput value={name} onChange={setName} placeholder="Prénom Nom" />
              {errors["name"] && (
                <p className="mt-1 text-xs" style={{ color: "var(--danger)" }}>{errors["name"]}</p>
              )}
            </div>
          </div>

          {/* Relation type */}
          <div>
            <FieldLabel>Type de relation</FieldLabel>
            <div className="flex flex-wrap gap-2">
              {ALL_RELATION_TYPES.map((type) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => setRelationType(type)}
                  className="transition-opacity focus:outline-none focus-visible:outline-none"
                  style={{ opacity: relationType === type ? 1 : 0.45, outline: relationType === type ? "2px solid var(--accent)" : "none", borderRadius: 99, outlineOffset: 2 }}
                >
                  <RelationChip type={type} />
                </button>
              ))}
            </div>
          </div>

          {/* Emails */}
          <div>
            <FieldLabel>Emails</FieldLabel>
            <div className="flex flex-col gap-2">
              {emails.map((email, i) => (
                <div key={i} className="flex gap-2">
                  <TextInput
                    value={email.value}
                    onChange={(v) => updateEmail(i, "value", v)}
                    placeholder="email@exemple.fr"
                    type="email"
                  />
                  <select
                    value={email.label}
                    onChange={(e) => updateEmail(i, "label", e.target.value)}
                    className="rounded-md border px-2 py-2 text-xs outline-none"
                    style={{ borderColor: "var(--border-subtle)", backgroundColor: "var(--surface-1)", color: "var(--text-secondary)" }}
                  >
                    <option value="perso">perso</option>
                    <option value="pro">pro</option>
                    <option value="autre">autre</option>
                  </select>
                  {emails.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeEmail(i)}
                      className="flex h-9 w-9 items-center justify-center rounded-md border transition-colors hover:bg-[var(--surface-2)]"
                      style={{ borderColor: "var(--border-subtle)", color: "var(--text-muted)" }}
                    >
                      <X size={13} />
                    </button>
                  )}
                </div>
              ))}
              <button
                type="button"
                onClick={addEmail}
                className="flex items-center gap-1.5 self-start rounded-md border px-2.5 py-1.5 text-xs transition-colors hover:bg-[var(--surface-2)]"
                style={{ borderColor: "var(--border-subtle)", color: "var(--text-muted)" }}
              >
                <Plus size={11} />
                Ajouter email
              </button>
            </div>
          </div>

          {/* Phones */}
          <div>
            <FieldLabel>Téléphones</FieldLabel>
            <div className="flex flex-col gap-2">
              {phones.map((phone, i) => (
                <div key={i} className="flex gap-2">
                  <TextInput
                    value={phone.value}
                    onChange={(v) => updatePhone(i, "value", v)}
                    placeholder="+33 6 …"
                    type="tel"
                  />
                  <select
                    value={phone.label}
                    onChange={(e) => updatePhone(i, "label", e.target.value)}
                    className="rounded-md border px-2 py-2 text-xs outline-none"
                    style={{ borderColor: "var(--border-subtle)", backgroundColor: "var(--surface-1)", color: "var(--text-secondary)" }}
                  >
                    <option value="mobile">mobile</option>
                    <option value="fixe">fixe</option>
                    <option value="pro">pro</option>
                  </select>
                  {phones.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removePhone(i)}
                      className="flex h-9 w-9 items-center justify-center rounded-md border transition-colors hover:bg-[var(--surface-2)]"
                      style={{ borderColor: "var(--border-subtle)", color: "var(--text-muted)" }}
                    >
                      <X size={13} />
                    </button>
                  )}
                </div>
              ))}
              <button
                type="button"
                onClick={addPhone}
                className="flex items-center gap-1.5 self-start rounded-md border px-2.5 py-1.5 text-xs transition-colors hover:bg-[var(--surface-2)]"
                style={{ borderColor: "var(--border-subtle)", color: "var(--text-muted)" }}
              >
                <Plus size={11} />
                Ajouter téléphone
              </button>
            </div>
          </div>

          {/* Birthday */}
          <div>
            <FieldLabel>Anniversaire</FieldLabel>
            <input
              type="date"
              value={birthday}
              onChange={(e) => setBirthday(e.target.value)}
              className="rounded-md border px-3 py-2 text-sm outline-none transition-colors focus:border-[var(--accent)]"
              style={{ borderColor: "var(--border-subtle)", backgroundColor: "var(--surface-1)", color: "var(--text-primary)" }}
            />
          </div>

          {/* Organisation — picker over real `organisation` entities. */}
          <div>
            <FieldLabel>Organisation</FieldLabel>
            <OrganisationSelector value={orgId} onChange={setOrgId} />
          </div>

          {/* Social links */}
          <div>
            <FieldLabel>Réseaux sociaux</FieldLabel>
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <LinkedinLogo size={15} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
                <TextInput value={linkedin} onChange={setLinkedin} placeholder="https://linkedin.com/in/…" />
              </div>
              <div className="flex items-center gap-2">
                <TwitterLogo size={15} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
                <TextInput value={twitter} onChange={setTwitter} placeholder="https://twitter.com/…" />
              </div>
              <div className="flex items-center gap-2">
                <GithubLogo size={15} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
                <TextInput value={github} onChange={setGithub} placeholder="https://github.com/…" />
              </div>
            </div>
          </div>

          {/* Tags */}
          <div>
            <FieldLabel>Tags</FieldLabel>
            <div className="flex flex-wrap items-center gap-1.5">
              {tags.map((tag) => (
                <span
                  key={tag}
                  className="flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs"
                  style={{ backgroundColor: "var(--surface-3)", color: "var(--text-muted)" }}
                >
                  {tag}
                  <button
                    type="button"
                    onClick={() => removeTag(tag)}
                    aria-label={`Supprimer ${tag}`}
                    className="outline-none focus:outline-none focus-visible:outline-none"
                  >
                    <X size={10} />
                  </button>
                </span>
              ))}
              <TagSelector value={tags} onChange={setTags} />
            </div>
          </div>

          {/* Notes */}
          <div>
            <FieldLabel>Notes</FieldLabel>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={6}
              placeholder="Notes libres en Markdown…"
              className="w-full resize-none rounded-md border px-3 py-2 text-sm outline-none transition-colors focus:border-[var(--accent)]"
              style={{ borderColor: "var(--border-subtle)", backgroundColor: "var(--surface-1)", color: "var(--text-primary)" }}
            />
          </div>

          {/* Error banner */}
          {createMutation.isError && (
            <p className="rounded-md border p-3 text-sm" style={{ borderColor: "var(--danger)", color: "var(--danger)", backgroundColor: "oklch(0.97 0.02 28)" }}>
              Impossible de créer le contact. Vérifie que le vault est bien ouvert.
            </p>
          )}

          {/* Actions — sticky bottom bar so the primary CTA stays in view
              while the user scrolls a long form. The negative margin /
              padding pair makes the bar span the full width of the
              container while keeping the buttons aligned with the form. */}
          <div
            className="sticky bottom-0 -mx-6 flex items-center gap-3 border-t px-6 py-3 backdrop-blur"
            style={{
              borderColor: "var(--border-subtle)",
              backgroundColor: "color-mix(in srgb, var(--surface-1) 90%, transparent)",
            }}
          >
            <button
              type="submit"
              disabled={createMutation.isPending}
              className="flex items-center gap-1.5 rounded-md px-5 py-2 text-sm font-medium transition-opacity hover:opacity-90 disabled:opacity-50"
              style={{ backgroundColor: "var(--accent)", color: "var(--accent-foreground)" }}
            >
              {createMutation.isPending ? "Création…" : "Créer"}
            </button>
            <Link
              href="/contacts"
              className="flex items-center rounded-md border px-5 py-2 text-sm font-medium transition-colors hover:bg-[var(--surface-2)]"
              style={{ borderColor: "var(--border)", color: "var(--text-secondary)" }}
            >
              Annuler
            </Link>
            <span className="ml-auto text-xs" style={{ color: "var(--text-muted)" }}>
              ⌘+Enter pour valider
            </span>
          </div>
        </form>
      </div>
    </AppShell>
  );
}
