"use client";

import { useMemo, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowSquareOut } from "@phosphor-icons/react";
import { Button, Tooltip } from "@supernote/ui";
import { trpc } from "@/lib/trpc/client";
import { entityName, findContactMatch } from "@/lib/contact-from-email";
import type { EmailAddress, EmailThread } from "@/lib/gmail";
import type { EntityRef } from "@/lib/dossier";
import { DossierTab } from "@/components/contacts/DossierTab";

/** Dernier interlocuteur du fil qui n'est pas moi. */
export function threadCorrespondent(thread: EmailThread | null, self: string): EmailAddress | null {
  if (!thread) return null;
  const me = self.toLowerCase();
  return [...thread.messages].reverse().find((m) => m.from.email.toLowerCase() !== me)?.from ?? null;
}

/** Fiche du coffre qui correspond à une adresse, `null` si aucune (ou adresse absente). */
export function useThreadContact(addr: EmailAddress | null): EntityRef | null {
  const personnes = trpc.entities.listSummaries.useQuery(
    { typeId: "personne", limit: 2000, offset: 0 },
    { enabled: !!addr, staleTime: 60_000 },
  );
  return useMemo(() => {
    if (!addr) return null;
    const rows = (personnes.data?.items ?? []).map((p) => ({
      id: p.id,
      typeId: "personne",
      fields: (p.fields ?? {}) as Record<string, unknown>,
    }));
    return findContactMatch(rows, addr.email, addr.name)?.row ?? null;
  }, [addr, personnes.data]);
}

/** Dossier du correspondant à côté du fil ; `fallback` quand il n'a pas de fiche. */
export function ThreadDossier({ contact, fallback = null }: { contact: EntityRef | null; fallback?: ReactNode }) {
  const navigate = useNavigate();
  if (!contact) return <>{fallback}</>;
  const name = entityName(contact) || "ce contact";
  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="truncate text-sm font-medium" style={{ color: "var(--text-primary)" }}>
          {name}
        </p>
        <Tooltip content="Ouvrir la fiche">
          <Button
            size="icon"
            variant="ghost"
            aria-label={`Ouvrir la fiche de ${name}`}
            onPress={() => navigate(`/contacts/${contact.id}`)}
          >
            <ArrowSquareOut size={16} />
          </Button>
        </Tooltip>
      </div>
      <DossierTab entity={contact} name={name} />
    </div>
  );
}
