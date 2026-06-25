"use client";

import { useMemo, useState } from "react";
import { Button } from "@supernote/ui";
import { UsersThree } from "@phosphor-icons/react";
import { OrganisationSelector } from "@/components/contacts/OrganisationSelector";
import { useContactsSource } from "@/components/contacts/useContactsSource";
import { pickContactEmail, dedupeEmails } from "@/lib/mail-recipients";

/**
 * Sélecteur « envoyer à un groupe » : on choisit une organisation (réutilise
 * `OrganisationSelector`, qui pioche/crée de vraies entités `organisation`),
 * on résout les emails de tous les contacts liés (1 par contact, préférant le
 * label "pro"), et `onAdd` les pousse dans la liste de destinataires du compose.
 *
 * Source contacts = `useContactsSource` (entités `personne` du coffre, déjà
 * adaptées + mode dégradé géré). Filtrage par `organisationId` côté client.
 */
export function OrgRecipientPicker({ onAdd }: { onAdd: (emails: string[]) => void }) {
  const [orgId, setOrgId] = useState<string | undefined>(undefined);
  const { contacts, isLoading } = useContactsSource();

  const { emails, missing } = useMemo(() => {
    if (!orgId) return { emails: [] as string[], missing: 0 };
    const members = contacts.filter((c) => c.organisationId === orgId);
    const collected: string[] = [];
    let noEmail = 0;
    for (const c of members) {
      const e = pickContactEmail(c.emails);
      if (e) collected.push(e);
      else noEmail++;
    }
    return { emails: dedupeEmails(collected), missing: noEmail };
  }, [orgId, contacts]);

  const add = () => {
    if (emails.length === 0) return;
    onAdd(emails);
    setOrgId(undefined);
  };

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <UsersThree size={14} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
        <div className="min-w-0 flex-1">
          <OrganisationSelector
            value={orgId}
            onChange={setOrgId}
            placeholder="Ajouter une organisation…"
          />
        </div>
        <Button size="sm" variant="ghost" isDisabled={emails.length === 0} onPress={add}>
          {emails.length > 0
            ? `Ajouter ${emails.length} destinataire${emails.length > 1 ? "s" : ""}`
            : "Ajouter"}
        </Button>
      </div>
      {orgId && (
        <p className="pl-6 text-[11px]" style={{ color: "var(--text-muted)" }}>
          {isLoading
            ? "Chargement des contacts…"
            : emails.length === 0
              ? "Aucun contact avec email dans cette organisation."
              : `${emails.length} email${emails.length > 1 ? "s" : ""} trouvé${emails.length > 1 ? "s" : ""}${missing > 0 ? ` · ${missing} contact${missing > 1 ? "s" : ""} sans email ignoré${missing > 1 ? "s" : ""}` : ""}`}
        </p>
      )}
    </div>
  );
}
