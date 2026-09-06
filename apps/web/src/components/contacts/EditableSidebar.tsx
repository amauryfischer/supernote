"use client";

/**
 * Editable sidebar for the contact detail page. Each field persists on blur
 * via `entities.update` (the worker merges fields with existing). Uses a
 * `hydratedFor` ref guard so query refetch after save doesn't clobber
 * in-flight typing — same pattern as the finance detail pages.
 *
 * Field serialization mirrors `contactFormToEntityFields`:
 *   - emails / phones / social / tags → JSON.stringify(...)
 *   - relationType / organisationId / birthday / photoUrl → plain string
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Input, Select, ListBox, ListBoxItem } from "@heroui/react";
import {
  Buildings,
  Calendar,
  Envelope,
  GithubLogo,
  LinkedinLogo,
  Phone as PhoneIcon,
  Plus,
  TwitterLogo,
  UploadSimple,
  X,
  CaretDown,
} from "@phosphor-icons/react";
import { trpc } from "@/lib/trpc/client";
import type { FieldValue } from "@supernote/ipc";
import { TagSelector } from "@/components/tags/TagSelector";
import {
  ALL_RELATION_TYPES,
  ContactAvatar,
  OrganisationSelector,
  RelationChip,
  formatDate,
  isBirthdaySoon,
  relativeBirthday,
} from "@/components/contacts";
import type {
  Contact,
  Email,
  Phone,
  RelationType,
  SocialLinks,
} from "@/components/contacts";


function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <label
      className="sn-eyebrow sn-eyebrow--compact block"
    >
      {children}
    </label>
  );
}

function SaveIndicator({
  isPending,
  isError,
  isSuccess,
}: {
  isPending: boolean;
  isError: boolean;
  isSuccess: boolean;
}) {
  if (isPending) {
    return (
      <span className="text-xs" style={{ color: "var(--text-muted)" }}>
        Enregistrement…
      </span>
    );
  }
  if (isError) {
    return (
      <span className="text-xs" style={{ color: "var(--danger)" }}>
        Échec
      </span>
    );
  }
  if (isSuccess) {
    return (
      <span className="text-xs" style={{ color: "var(--text-muted)" }}>
        Enregistré
      </span>
    );
  }
  return null;
}

interface EditableSidebarProps {
  contact: Contact;
  hasLiveBackend: boolean;
}

export function EditableSidebar({ contact, hasLiveBackend }: EditableSidebarProps) {
  const utils = trpc.useUtils();
  const updateMutation = trpc.entities.update.useMutation({
    onSuccess: (data) => {
      void utils.entities.get.invalidate({ id: data.id });
      void utils.entities.list.invalidate({ typeId: "personne" });
      void utils.entities.listSummaries.invalidate({ typeId: "personne" });
    },
  });

  const [name, setName] = useState(contact.name);
  const [photoUrl, setPhotoUrl] = useState<string | undefined>(contact.photoUrl);
  const [emails, setEmails] = useState<Email[]>(contact.emails);
  const [phones, setPhones] = useState<Phone[]>(contact.phones);
  const [relationType, setRelationType] = useState<RelationType>(contact.relationType);
  const [organisationId, setOrganisationId] = useState<string | undefined>(contact.organisationId);
  const [birthday, setBirthday] = useState(contact.birthday ?? "");
  const [linkedin, setLinkedin] = useState(contact.social.linkedin ?? "");
  const [twitter, setTwitter] = useState(contact.social.twitter ?? "");
  const [github, setGithub] = useState(contact.social.github ?? "");
  const [tags, setTags] = useState<string[]>(contact.tags);
  // Alias chips — short alternative names ("LD", "Linhdan") that the @-mention
  // picker resolves to this contact (the worker's MiniSearch index appends
  // them to the indexed `title` field via `deriveTitle`).
  const [aliases, setAliases] = useState<string[]>(contact.aliases);
  const [aliasInput, setAliasInput] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  // Hydrate local state once per contact id. Without this guard, the
  // query.invalidate → refetch after each save would clobber in-flight
  // edits (especially typing into emails/phones). After hydration, server
  // and local state stay in sync via onBlur persists.
  const hydratedFor = useRef<string | null>(null);
  useEffect(() => {
    if (hydratedFor.current === contact.id) return;
    hydratedFor.current = contact.id;
    setName(contact.name);
    setPhotoUrl(contact.photoUrl);
    setEmails(contact.emails);
    setPhones(contact.phones);
    setRelationType(contact.relationType);
    setOrganisationId(contact.organisationId);
    setBirthday(contact.birthday ?? "");
    setLinkedin(contact.social.linkedin ?? "");
    setTwitter(contact.social.twitter ?? "");
    setGithub(contact.social.github ?? "");
    setTags(contact.tags);
    setAliases(contact.aliases);
  }, [contact]);

  const persist = useCallback(
    (patch: Record<string, FieldValue>, opts?: { tags?: string[] }) => {
      if (!hasLiveBackend) return;
      updateMutation.mutate({
        id: contact.id,
        fields: patch,
        ...(opts?.tags ? { tags: opts.tags } : {}),
      });
    },
    [contact.id, hasLiveBackend, updateMutation],
  );

  const persistSocial = useCallback(
    (next: SocialLinks) => {
      persist({ social: JSON.stringify(next) });
    },
    [persist],
  );

  function handlePhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result);
      setPhotoUrl(dataUrl);
      persist({ photoUrl: dataUrl });
    };
    reader.readAsDataURL(file);
  }

  function updateEmail(i: number, field: keyof Email, val: string) {
    setEmails((prev) => prev.map((e, idx) => (idx === i ? { ...e, [field]: val } : e)));
  }
  function commitEmails(next: Email[]) {
    setEmails(next);
    persist({ emails: JSON.stringify(next) });
  }
  function addEmail() {
    setEmails((prev) => [...prev, { value: "", label: "perso" }]);
    // No persist on empty row — wait for user to fill in + blur.
  }
  function removeEmail(i: number) {
    commitEmails(emails.filter((_, idx) => idx !== i));
  }

  function updatePhone(i: number, field: keyof Phone, val: string) {
    setPhones((prev) => prev.map((p, idx) => (idx === i ? { ...p, [field]: val } : p)));
  }
  function commitPhones(next: Phone[]) {
    setPhones(next);
    persist({ phones: JSON.stringify(next) });
  }
  function addPhone() {
    setPhones((prev) => [...prev, { value: "", label: "mobile" }]);
  }
  function removePhone(i: number) {
    commitPhones(phones.filter((_, idx) => idx !== i));
  }

  function commitTags(next: string[]) {
    setTags(next);
    // entitiesUpdate accepts a top-level `tags` arg; we also mirror into
    // fields for adapter symmetry (entityToContact reads entity.tags first).
    persist({ tags: JSON.stringify(next) }, { tags: next });
  }
  function removeTag(t: string) {
    commitTags(tags.filter((x) => x !== t));
  }

  function addAlias() {
    const a = aliasInput.trim();
    if (!a || aliases.includes(a)) {
      setAliasInput("");
      return;
    }
    const next = [...aliases, a];
    setAliases(next);
    setAliasInput("");
    // Stored as a JSON-encoded string array — matches `deriveTitle` in the
    // worker (which appends aliases to the MiniSearch `title` field so
    // "@LD" resolves to a contact whose canonical name is "Linh Dan").
    persist({ aliases: JSON.stringify(next) });
  }
  function removeAlias(a: string) {
    const next = aliases.filter((x) => x !== a);
    setAliases(next);
    persist({ aliases: JSON.stringify(next) });
  }

  function handleOrgChange(next: string | undefined) {
    setOrganisationId(next);
    persist({ organisationId: next ?? "" });
  }

  // Pull the linked organisation entity to surface its `website` on the
  // "Org" quick-action button. Disabled until a real id is selected — for
  // legacy fixture ids (`org-1`, …) the query will simply error and the
  // button stays hidden, which is the correct behaviour.
  const orgEntityQuery = trpc.entities.get.useQuery(
    { id: organisationId ?? "" },
    { enabled: !!organisationId, retry: false },
  );
  const orgWebsite =
    typeof orgEntityQuery.data?.fields["website"] === "string"
      ? (orgEntityQuery.data.fields["website"] as string)
      : "";

  const primaryEmail = emails[0];
  const primaryPhone = phones[0];
  const soon = isBirthdaySoon(birthday || undefined);
  const relBirthday = relativeBirthday(birthday || undefined);

  return (
    <aside
      className="flex flex-col gap-4 overflow-y-auto border-r p-6"
      style={{ width: 320, minWidth: 320, borderColor: "var(--border-subtle)" }}
    >
      {/* Avatar + name + relation chips */}
      <div className="flex flex-col items-center gap-3 text-center">
        <Button
          type="button"
          variant="ghost"
          isIconOnly
          onPress={() => fileRef.current?.click()}
          className="group relative rounded-full p-0 transition-opacity hover:opacity-90"
          aria-label="Modifier la photo"
        >
          <ContactAvatar name={name || "?"} photoUrl={photoUrl} size={88} />
          <span
            className="absolute inset-0 flex items-center justify-center rounded-full opacity-0 transition-opacity group-hover:opacity-100"
            style={{
              backgroundColor: "color-mix(in oklch, var(--surface-0) 50%, transparent)",
              color: "var(--text-primary)",
            }}
          >
            <UploadSimple size={20} />
          </span>
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handlePhotoChange}
        />
        <div className="w-full">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => persist({ name })}
            placeholder="Sans nom"
            className="w-full rounded bg-transparent px-1 text-center text-xl font-semibold outline-none transition-colors focus:bg-[var(--surface-1)]"
            style={{ color: "var(--text-primary)" }}
          />
          <div className="mt-1.5 flex flex-wrap justify-center gap-1.5">
            {ALL_RELATION_TYPES.map((type) => (
              <Button
                key={type}
                type="button"
                variant="ghost"
                onPress={() => {
                  setRelationType(type);
                  persist({ relationType: type });
                }}
                className="min-w-0 p-0 transition-opacity focus:outline-none focus-visible:outline-none"
                style={{
                  opacity: relationType === type ? 1 : 0.4,
                  borderRadius: 99,
                }}
                aria-pressed={relationType === type}
                aria-label={`Type de relation : ${type}`}
              >
                <RelationChip type={type} />
              </Button>
            ))}
          </div>
        </div>
      </div>

      {/* Quick action buttons */}
      <div className="flex flex-wrap justify-center gap-2">
        {primaryEmail && primaryEmail.value && (
          <a
            href={`mailto:${primaryEmail.value}`}
            className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors hover:opacity-90"
            style={{ backgroundColor: "var(--btn-primary-bg)", color: "var(--btn-primary-fg)" }}
          >
            <Envelope size={12} />
            Email
          </a>
        )}
        {primaryPhone && primaryPhone.value && (
          <a
            href={`tel:${primaryPhone.value}`}
            className="flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors hover:bg-[var(--surface-2)]"
            style={{ borderColor: "var(--border)", color: "var(--text-secondary)" }}
          >
            <PhoneIcon size={12} />
            Appeler
          </a>
        )}
        {orgWebsite && (
          <a
            href={orgWebsite}
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

      {/* Emails */}
      <div className="flex flex-col gap-1.5">
        <FieldLabel>Emails</FieldLabel>
        {emails.map((email, i) => (
          <div key={i} className="flex gap-1.5">
            <Input
              type="email"
              value={email.value}
              onChange={(e) => updateEmail(i, "value", e.target.value)}
              onBlur={() => commitEmails(emails)}
              placeholder="email@…"
              className="flex-1"
            />
            <Select
              selectedKey={email.label}
              onSelectionChange={(key) => {
                const val = String(key) as Email["label"];
                commitEmails(emails.map((em, idx) => (idx === i ? { ...em, label: val } : em)));
              }}
              aria-label="Label email"
              className="w-20"
            >
              <Select.Trigger className="rounded-md border px-1.5 py-1.5 text-xs outline-none" style={{ borderColor: "var(--border-subtle)", backgroundColor: "var(--surface-1)", color: "var(--text-secondary)" }}>
                <Select.Value />
                <CaretDown size={10} />
              </Select.Trigger>
              <Select.Popover>
                <ListBox>
                  <ListBoxItem key="perso">perso</ListBoxItem>
                  <ListBoxItem key="pro">pro</ListBoxItem>
                  <ListBoxItem key="autre">autre</ListBoxItem>
                </ListBox>
              </Select.Popover>
            </Select>
            <Button
              type="button"
              isIconOnly
              variant="ghost"
              size="sm"
              onPress={() => removeEmail(i)}
              className="h-8 w-8 flex-shrink-0 rounded-md border"
              style={{ borderColor: "var(--border-subtle)", color: "var(--text-muted)" }}
              aria-label="Supprimer l'email"
            >
              <X size={12} />
            </Button>
          </div>
        ))}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onPress={addEmail}
          className="flex items-center gap-1.5 self-start rounded-md border px-2 py-1 text-xs"
          style={{ borderColor: "var(--border-subtle)", color: "var(--text-muted)" }}
        >
          <Plus size={11} />
          Ajouter email
        </Button>
      </div>

      {/* Phones */}
      <div className="flex flex-col gap-1.5">
        <FieldLabel>Téléphones</FieldLabel>
        {phones.map((phone, i) => (
          <div key={i} className="flex gap-1.5">
            <Input
              type="tel"
              value={phone.value}
              onChange={(e) => updatePhone(i, "value", e.target.value)}
              onBlur={() => commitPhones(phones)}
              placeholder="+33 …"
              className="flex-1"
            />
            <Select
              selectedKey={phone.label}
              onSelectionChange={(key) => {
                const val = String(key) as Phone["label"];
                commitPhones(phones.map((ph, idx) => (idx === i ? { ...ph, label: val } : ph)));
              }}
              aria-label="Label téléphone"
              className="w-20"
            >
              <Select.Trigger className="rounded-md border px-1.5 py-1.5 text-xs outline-none" style={{ borderColor: "var(--border-subtle)", backgroundColor: "var(--surface-1)", color: "var(--text-secondary)" }}>
                <Select.Value />
                <CaretDown size={10} />
              </Select.Trigger>
              <Select.Popover>
                <ListBox>
                  <ListBoxItem key="mobile">mobile</ListBoxItem>
                  <ListBoxItem key="fixe">fixe</ListBoxItem>
                  <ListBoxItem key="pro">pro</ListBoxItem>
                </ListBox>
              </Select.Popover>
            </Select>
            <Button
              type="button"
              isIconOnly
              variant="ghost"
              size="sm"
              onPress={() => removePhone(i)}
              className="h-8 w-8 flex-shrink-0 rounded-md border"
              style={{ borderColor: "var(--border-subtle)", color: "var(--text-muted)" }}
              aria-label="Supprimer le téléphone"
            >
              <X size={12} />
            </Button>
          </div>
        ))}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onPress={addPhone}
          className="flex items-center gap-1.5 self-start rounded-md border px-2 py-1 text-xs"
          style={{ borderColor: "var(--border-subtle)", color: "var(--text-muted)" }}
        >
          <Plus size={11} />
          Ajouter téléphone
        </Button>
      </div>

      {/* Organisation — picker over real `organisation` entities. */}
      <div className="flex flex-col gap-1.5">
        <FieldLabel>Organisation</FieldLabel>
        <OrganisationSelector value={organisationId} onChange={handleOrgChange} />
      </div>

      {/* Birthday */}
      <div className="flex flex-col gap-1.5">
        <FieldLabel>Anniversaire</FieldLabel>
        <Input
          type="date"
          value={birthday}
          onChange={(e) => setBirthday(e.target.value)}
          onBlur={() => persist({ birthday })}
          className="w-full"
        />
        {birthday && relBirthday && (
          <span
            className="text-xs"
            style={{ color: soon ? "oklch(0.55 0.20 28)" : "var(--text-muted)" }}
          >
            <Calendar size={11} className="mr-1 inline" />
            {formatDate(birthday)} ({relBirthday})
          </span>
        )}
      </div>

      {/* Social links */}
      <div className="flex flex-col gap-1.5">
        <FieldLabel>Réseaux sociaux</FieldLabel>
        <div className="flex items-center gap-2">
          <LinkedinLogo size={14} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
          <Input
            type="url"
            value={linkedin}
            onChange={(e) => setLinkedin(e.target.value)}
            onBlur={() => persistSocial({ linkedin, twitter, github })}
            placeholder="linkedin.com/in/…"
            className="flex-1"
          />
        </div>
        <div className="flex items-center gap-2">
          <TwitterLogo size={14} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
          <Input
            type="url"
            value={twitter}
            onChange={(e) => setTwitter(e.target.value)}
            onBlur={() => persistSocial({ linkedin, twitter, github })}
            placeholder="twitter.com/…"
            className="flex-1"
          />
        </div>
        <div className="flex items-center gap-2">
          <GithubLogo size={14} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
          <Input
            type="url"
            value={github}
            onChange={(e) => setGithub(e.target.value)}
            onBlur={() => persistSocial({ linkedin, twitter, github })}
            placeholder="github.com/…"
            className="flex-1"
          />
        </div>
      </div>

      {/* Aliases */}
      <div className="flex flex-col gap-1.5">
        <FieldLabel>Alias</FieldLabel>
        <div className="flex flex-wrap gap-1.5">
          {aliases.map((alias) => (
            <span
              key={alias}
              className="flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs"
              style={{
                backgroundColor: "color-mix(in oklch, var(--accent) 14%, var(--surface-3))",
                color: "var(--text-secondary)",
              }}
            >
              {alias}
              <Button
                type="button"
                isIconOnly
                variant="ghost"
                size="sm"
                onPress={() => removeAlias(alias)}
                className="relative h-auto min-h-0 min-w-0 p-0 after:absolute after:-inset-2 after:content-['']"
                aria-label={`Supprimer l'alias ${alias}`}
              >
                <X size={10} />
              </Button>
            </span>
          ))}
        </div>
        <div className="flex gap-1.5">
          <Input
            type="text"
            value={aliasInput}
            onChange={(e) => setAliasInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addAlias();
              }
            }}
            placeholder="Ajouter un alias…"
            className="flex-1"
          />
          <Button
            type="button"
            isIconOnly
            variant="ghost"
            size="sm"
            onPress={addAlias}
            className="rounded-md border px-2 py-1"
            style={{ borderColor: "var(--border-subtle)", color: "var(--text-muted)" }}
            aria-label="Ajouter l'alias"
          >
            <Plus size={11} />
          </Button>
        </div>
        <p className="text-[10px]" style={{ color: "var(--text-muted)" }}>
          Reconnu dans les notes via @ (ex: @LD).
        </p>
      </div>

      {/* Tags */}
      <div className="flex flex-col gap-1.5">
        <FieldLabel>Tags</FieldLabel>
        <div className="flex flex-wrap items-center gap-1.5">
          {tags.map((tag) => (
            <span
              key={tag}
              className="flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs"
              style={{ backgroundColor: "var(--surface-3)", color: "var(--text-muted)" }}
            >
              {tag}
              <Button
                type="button"
                isIconOnly
                variant="ghost"
                size="sm"
                onPress={() => removeTag(tag)}
                className="relative h-auto min-h-0 min-w-0 p-0 outline-none after:absolute after:-inset-2 after:content-[''] focus:outline-none focus-visible:outline-none"
                aria-label={`Supprimer ${tag}`}
              >
                <X size={10} />
              </Button>
            </span>
          ))}
          <TagSelector value={tags} onChange={commitTags} />
        </div>
      </div>

      <div className="flex items-center justify-end pt-1" style={{ minHeight: 18 }}>
        <SaveIndicator
          isPending={updateMutation.isPending}
          isError={updateMutation.isError}
          isSuccess={updateMutation.isSuccess}
        />
      </div>
    </aside>
  );
}
