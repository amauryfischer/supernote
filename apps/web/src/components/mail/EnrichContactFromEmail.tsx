"use client";

/**
 * Crée ou complète un contact `personne` depuis l'expéditeur d'un email.
 *
 * Formulaire pré-rempli par les heuristiques de `lib/contact-from-email`
 * (nom affiché, adresse, domaine, signature), rapproché du coffre (contact au
 * même email, organisation du même domaine ou au nom proche), puis affiné par
 * l'IA locale si elle est configurée. Rien n'est écrit avant validation.
 */

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Button, Chip, Input, Spinner } from "@heroui/react";
import { UserPlus } from "@phosphor-icons/react";
import { Modal, Tooltip } from "@supernote/ui";
import { trpc } from "@/lib/trpc/client";
import { useEntityMutations } from "@/components/bases/hooks";
import { contactFormToEntityFields, entityToContact } from "@/components/contacts/entityAdapter";
import { isAiConfigured, runLocalPrompt } from "@/lib/mail-ai";
import {
  buildContactPrompt,
  draftFromContact,
  entityName,
  findContactMatch,
  findOrgByName,
  findOrgForDomain,
  guessContactFromEmail,
  joinName,
  looseKey,
  parseContactAiResponse,
  type AiContactKey,
  type ContactDraft,
  type ContactMatch,
  type EmailContactGuess,
} from "@/lib/contact-from-email";
import type { EmailMessage } from "@/lib/gmail";
import type { EntitySummary, FieldValue } from "@supernote/ipc";
import { useActionFeedback, FeedbackIcon } from "@/lib/action-feedback";

export interface EnrichContactFromEmailProps {
  /** Message dont on lit l'expéditeur et la signature (`bodyText`). */
  message: EmailMessage;
  /** Contrôlé par le fil : le menu « Plus » ouvre la même modale que le bouton icône. */
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const LABEL = "Créer / compléter le contact";

/** Bouton icône (à côté de l'adresse du correspondant) et sa modale. */
export function EnrichContactFromEmail({ message, open, onOpenChange }: EnrichContactFromEmailProps) {
  const fb = useActionFeedback();
  if (!message.from.email) return null;

  return (
    <>
      <Tooltip content={LABEL}>
        <Button
          isIconOnly
          variant="ghost"
          size="sm"
          aria-label={LABEL}
          className="sn-hit h-6 min-h-6 w-6 min-w-6 shrink-0"
          onPress={() => onOpenChange(true)}
        >
          <FeedbackIcon state={fb.state} size={13} idle={<UserPlus size={13} />} />
        </Button>
      </Tooltip>
      <Modal
        isOpen={open}
        onOpenChange={onOpenChange}
        title="Contact depuis l'email"
        size="lg"
        className="max-h-[calc(100dvh-2rem)] overflow-y-auto"
      >
        {open && (
          <ContactForm message={message} onSaved={fb.succeed} onDone={() => onOpenChange(false)} />
        )}
      </Modal>
    </>
  );
}

const FIELDS: { key: keyof ContactDraft; label: string; type: string }[] = [
  { key: "firstName", label: "Prénom", type: "text" },
  { key: "lastName", label: "Nom", type: "text" },
  { key: "email", label: "Email", type: "email" },
  { key: "phone", label: "Téléphone", type: "tel" },
  { key: "organisation", label: "Organisation", type: "text" },
  { key: "role", label: "Poste", type: "text" },
  { key: "linkedin", label: "LinkedIn", type: "url" },
];

// Nom, téléphone et liens déjà trouvés viennent tels quels de l'en-tête ou de la signature : un petit
// modèle ne ferait que les reformater, ou confondre l'expéditeur avec le « Bonjour X » du corps.
const AI_CAN_REPLACE = new Set<AiContactKey>(["organisation", "role"]);

const inputClass =
  "w-full rounded-md border px-3 py-2 text-sm outline-none transition-colors focus:border-[var(--accent)]";
const inputStyle = {
  borderColor: "var(--border-subtle)",
  backgroundColor: "var(--surface-1)",
  color: "var(--text-primary)",
};

function text(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function ContactForm({
  message,
  onSaved,
  onDone,
}: {
  message: EmailMessage;
  onSaved: () => void;
  onDone: () => void;
}) {
  const saveFb = useActionFeedback();
  const idPrefix = useId();
  const guess = useMemo(
    () => guessContactFromEmail(message.from, message.bodyText ?? ""),
    [message.from, message.bodyText],
  );

  // Mêmes entrées que /contacts et OrganisationSelector : cache partagé.
  const contactsQ = trpc.entities.list.useQuery({ typeId: "personne", limit: 500 }, { retry: false });
  const orgsQ = trpc.entities.list.useQuery({ typeId: "organisation", limit: 200 }, { retry: false });
  const contacts = useMemo<EntitySummary[]>(() => contactsQ.data?.items ?? [], [contactsQ.data]);
  const orgs = useMemo<EntitySummary[]>(() => orgsQ.data?.items ?? [], [orgsQ.data]);
  const loading = contactsQ.isPending || orgsQ.isPending;

  const [draft, setDraft] = useState<ContactDraft | null>(null);
  const [match, setMatch] = useState<ContactMatch<EntitySummary>>(null);
  const [initial, setInitial] = useState<ContactDraft | null>(null);
  const [domainOrgId, setDomainOrgId] = useState<string | null>(null);
  const [baseSuggestions, setBaseSuggestions] = useState<Partial<ContactDraft>>({});
  const [aiSuggestions, setAiSuggestions] = useState<Partial<ContactDraft>>({});
  const [ai, setAi] = useState<"off" | "running" | "done" | "failed">("off");
  // Champs à ne plus écraser : saisis par l'utilisateur, déjà renseignés sur le contact, ou org trouvée au coffre.
  const locked = useRef(new Set<keyof ContactDraft>());
  const alive = useRef(true);
  const aiStarted = useRef(false);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    if (loading || draft) return;
    const init = initialDraft(guess, contacts, orgs, locked.current);
    setMatch(init.match);
    setInitial(init.current);
    setDomainOrgId(init.domainOrgId);
    setBaseSuggestions(init.suggestions);
    setDraft(init.draft);
  }, [loading, draft, guess, contacts, orgs]);

  useEffect(() => {
    if (!draft || aiStarted.current || guess.automated || !isAiConfigured()) return;
    aiStarted.current = true;
    setAi("running");
    runLocalPrompt(buildContactPrompt(message.from, guess.signature))
      .then((raw) => {
        if (!alive.current) return;
        const found = parseContactAiResponse(raw);
        setAiSuggestions(
          Object.fromEntries(Object.entries(found).filter(([k]) => locked.current.has(k as AiContactKey))),
        );
        setDraft((d) => {
          if (!d) return d;
          const next = { ...d };
          for (const [k, v] of Object.entries(found) as [AiContactKey, string][]) {
            if (locked.current.has(k)) continue;
            if (d[k] && (!AI_CAN_REPLACE.has(k) || looseKey(d[k]) === looseKey(v))) continue;
            next[k] = v;
          }
          return next;
        });
        setAi("done");
      })
      .catch(() => {
        if (alive.current) setAi("failed");
      });
  }, [draft, guess, message.from]);

  const linkedOrg = useMemo(
    () => (draft ? findOrgByName(orgs, draft.organisation) : null),
    [orgs, draft],
  );

  const personMut = useEntityMutations("personne");
  const orgMut = useEntityMutations("organisation");
  const utils = trpc.useUtils();

  if (loading || !draft) {
    return (
      <div className="flex items-center gap-2 text-sm" style={{ color: "var(--text-muted)" }}>
        <Spinner size="sm" /> Recherche dans les contacts…
      </div>
    );
  }

  const setField = (k: keyof ContactDraft, v: string) => {
    locked.current.add(k);
    setDraft((d) => (d ? { ...d, [k]: v } : d));
  };

  const suggestionFor = (k: keyof ContactDraft): string => {
    const v = aiSuggestions[k] || baseSuggestions[k] || "";
    return v && looseKey(v) !== looseKey(draft[k]) ? v : "";
  };

  const orgName = draft.organisation.trim();
  const createsOrg = !linkedOrg && orgName.length > 0;

  const save = async () => {
    const name = joinName(draft) || draft.email.trim();
    if (!name) {
      saveFb.fail(new Error("Il faut au moins un nom ou un email"));
      return;
    }
    const done = await saveFb.run(async () => {
      let orgId = linkedOrg?.id;
      if (createsOrg) {
        const website = draft.website.trim();
        const org = await orgMut.create.mutateAsync({
          typeId: "organisation",
          fields: website ? { name: orgName, website } : { name: orgName },
          body: "",
        });
        orgId = org?.id;
      }
      const company = linkedOrg ? entityName(linkedOrg) : orgName;
      if (match && initial) {
        const patch = contactPatch(match.row, draft, initial, { name, orgId, company, guess });
        // Contact déjà à jour : rien à écrire.
        if (Object.keys(patch).length === 0) return true;
        await personMut.update.mutateAsync({ id: match.row.id, fields: patch });
      } else {
        await personMut.create.mutateAsync({
          typeId: "personne",
          fields: newContactFields(draft, { name, orgId, company, guess }),
          body: "",
        });
      }
      void utils.entities.get.invalidate();
      void utils.entities.listSummaries.invalidate();
      return true;
    });
    if (!done) return;
    onSaved();
    onDone();
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2 text-xs" style={{ color: "var(--text-muted)" }}>
        {match ? (
          <>
            <Chip size="sm" variant="soft" color="success">
              Contact existant
            </Chip>
            <span className="min-w-0 break-words">
              {entityName(match.row)} ({match.by === "email" ? "même email" : "même nom"})
            </span>
          </>
        ) : (
          <Chip size="sm" variant="soft" color="accent">
            Nouveau contact
          </Chip>
        )}
        {guess.automated && (
          <Chip size="sm" variant="soft" color="warning">
            Adresse automatique
          </Chip>
        )}
        {ai === "running" && (
          <span className="flex items-center gap-1.5">
            <Spinner size="sm" /> L'IA locale affine…
          </span>
        )}
        {ai === "done" && <span>Affiné par l'IA locale</span>}
        {ai === "failed" && <span>IA indisponible : pré-rempli par l'en-tête et la signature</span>}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {FIELDS.map(({ key, label, type }) => {
          const id = `${idPrefix}-${key}`;
          const suggestion = suggestionFor(key);
          return (
            <div key={key} className={`flex min-w-0 flex-col gap-1${key === "linkedin" ? " sm:col-span-2" : ""}`}>
              <label htmlFor={id} className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
                {label}
              </label>
              <Input
                id={id}
                type={type}
                value={draft[key]}
                onChange={(e) => setField(key, e.target.value)}
                className={inputClass}
                style={inputStyle}
              />
              {suggestion && (
                <Button
                  variant="ghost"
                  size="sm"
                  onPress={() => setField(key, suggestion)}
                  className="sn-hit h-auto min-h-0 justify-start px-0 py-0.5 text-left text-xs"
                  style={{ color: "var(--text-muted)" }}
                >
                  <span className="truncate">Remplacer par « {suggestion} »</span>
                </Button>
              )}
              {key === "organisation" && orgName && (
                <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                  {linkedOrg
                    ? `Liée à l'organisation existante « ${entityName(linkedOrg)} »${
                        linkedOrg.id === domainOrgId ? ` (via @${guess.domain})` : ""
                      }`
                    : "Nouvelle organisation, créée à l'enregistrement"}
                </span>
              )}
            </div>
          );
        })}
        {createsOrg && (
          <div className="flex min-w-0 flex-col gap-1 sm:col-span-2">
            <label
              htmlFor={`${idPrefix}-website`}
              className="text-xs font-medium"
              style={{ color: "var(--text-secondary)" }}
            >
              Site web de l'organisation
            </label>
            <Input
              id={`${idPrefix}-website`}
              type="url"
              value={draft.website}
              onChange={(e) => setField("website", e.target.value)}
              className={inputClass}
              style={inputStyle}
            />
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-end gap-2">
        {saveFb.error && (
          <span role="alert" className="mr-auto text-xs" style={{ color: "var(--color-danger)" }}>
            {saveFb.error}
          </span>
        )}
        <Button variant="ghost" size="sm" onPress={onDone} isDisabled={saveFb.isPending}>
          Annuler
        </Button>
        <Button variant="primary" size="sm" onPress={() => void save()} isDisabled={saveFb.isPending}>
          {saveFb.isPending ? "Enregistrement…" : match ? "Compléter le contact" : "Créer le contact"}
        </Button>
      </div>
    </div>
  );
}

function initialDraft(
  guess: EmailContactGuess,
  contacts: EntitySummary[],
  orgs: EntitySummary[],
  locked: Set<keyof ContactDraft>,
): {
  draft: ContactDraft;
  match: ContactMatch<EntitySummary>;
  current: ContactDraft | null;
  domainOrgId: string | null;
  suggestions: Partial<ContactDraft>;
} {
  const domainOrg = findOrgForDomain(contacts, orgs, guess.domain);
  const guessed = domainOrg ? { ...guess.draft, organisation: entityName(domainOrg) } : guess.draft;
  if (domainOrg) locked.add("organisation");
  const match = findContactMatch(contacts, guessed.email, joinName(guessed));
  if (!match) return { draft: guessed, match, current: null, domainOrgId: domainOrg?.id ?? null, suggestions: {} };

  const current = draftFromContact(match.row, orgs, guessed.email);
  const draft = { ...current, email: guessed.email, website: guessed.website };
  const suggestions: Partial<ContactDraft> = {};
  for (const k of Object.keys(current) as (keyof ContactDraft)[]) {
    if (k === "email" || k === "website") continue;
    if (!current[k]) {
      draft[k] = guessed[k];
    } else {
      locked.add(k);
      if (guessed[k] && looseKey(guessed[k]) !== looseKey(current[k])) suggestions[k] = guessed[k];
    }
  }
  return { draft, match, current, domainOrgId: domainOrg?.id ?? null, suggestions };
}

interface SaveContext {
  name: string;
  orgId: string | undefined;
  company: string;
  guess: EmailContactGuess;
}

function newContactFields(d: ContactDraft, { name, orgId, company, guess }: SaveContext): Record<string, FieldValue> {
  const email = d.email.trim();
  const phone = d.phone.trim();
  const linkedin = d.linkedin.trim();
  return {
    ...contactFormToEntityFields({
      name,
      emails: email ? [{ value: email, label: guess.domain ? "pro" : "perso" }] : [],
      phones: phone ? [{ value: phone, label: guess.phoneLabel }] : [],
      organisationId: orgId,
      relationType: "connaissance",
      linkedin: linkedin || undefined,
      tags: [],
      notes: "",
    }),
    // La fiche contact lit `emails`/`phones`/`organisationId`/`social`, la base « Personnes » ces scalaires.
    email,
    phone,
    company,
    role: d.role.trim(),
    linkedin,
  };
}

/** Complète sans effacer : seules les valeurs nouvelles ou modifiées partent, les listes sont fusionnées. */
function contactPatch(
  row: EntitySummary,
  d: ContactDraft,
  initial: ContactDraft,
  { name, orgId, company, guess }: SaveContext,
): Record<string, FieldValue> {
  const f = row.fields;
  const c = entityToContact(row);
  const patch: Record<string, FieldValue> = {};
  if (name !== joinName(initial)) patch.name = name;

  const email = d.email.trim().toLowerCase();
  if (email && !c.emails.some((e) => e.value.trim().toLowerCase() === email)) {
    patch.emails = JSON.stringify([...c.emails, { value: email, label: guess.domain ? "pro" : "perso" }]);
  }
  if (email && !text(f.email)) patch.email = email;

  const phone = d.phone.trim();
  if (phone && phone !== initial.phone) {
    const digits = (s: string) => s.replace(/\D/g, "");
    if (!c.phones.some((p) => digits(p.value) === digits(phone))) {
      patch.phones = JSON.stringify([...c.phones, { value: phone, label: guess.phoneLabel }]);
    }
    patch.phone = phone;
  }

  if (orgId && orgId !== text(f.organisationId)) patch.organisationId = orgId;
  if (company && company !== text(f.company)) patch.company = company;
  const role = d.role.trim();
  if (role && role !== text(f.role)) patch.role = role;
  const linkedin = d.linkedin.trim();
  if (linkedin && linkedin !== initial.linkedin) {
    patch.linkedin = linkedin;
    patch.social = JSON.stringify({ ...c.social, linkedin });
  }
  return patch;
}
