"use client";

/**
 * EnrichContactFromEmail — surface d'enrichissement d'un contact « personne »
 * à partir de la signature d'un email.
 *
 * 1. Extrait { phone, mobile, role, company, linkedin, website } de
 *    `message.bodyText` via `extractSignatureFields` (pur, lib signature-extract).
 * 2. Cherche un contact `personne` existant dont le champ `email` correspond à
 *    `message.from.email` (insensible à la casse) parmi les entités listées par
 *    `trpc.entities.list({ typeId: "personne" })`.
 * 3. Présente les champs extraits avec cases à cocher (conflits signalés) et,
 *    sur validation, applique le patch via `useEntityMutations("personne")` —
 *    update si le contact existe, sinon create (nouvelle fiche pré-remplie).
 *
 * Ne modifie NI le worker NI l'IPC : réutilise les procédures `entities.*`
 * existantes via le hook `useEntityMutations` de la feature Bases.
 *
 * HeroUI v3 (Button, Chip, Checkbox) + Modal/useToast de @supernote/ui.
 */

import { useEffect, useMemo, useState } from "react";
import { Button, Chip, Checkbox } from "@heroui/react";
import { Modal, useToast } from "@supernote/ui";
import { trpc } from "@/lib/trpc/client";
import {
  extractSignatureFields,
  hasAnyExtractedField,
  buildContactApplications,
  findContactByEmail,
  type FieldApplication,
} from "@/lib/signature-extract";
import { useEntityMutations } from "@/components/bases/hooks";
import type { EmailMessage } from "@/lib/gmail";
import type { FieldValue } from "@supernote/ipc";

const PERSONNE_TYPE_ID = "personne";

interface ContactRow {
  id: string;
  fields: Record<string, FieldValue>;
}

export interface EnrichContactFromEmailProps {
  /** Email source dont on lit la signature (`bodyText`) et l'expéditeur. */
  message: EmailMessage;
  /** Variante d'affichage : bouton compact (déclencheur) ou panneau inline. */
  variant?: "button" | "inline";
  /** Libellé du bouton déclencheur (variant="button"). */
  triggerLabel?: string;
}

/**
 * Bouton qui ouvre une modale d'enrichissement, OU panneau inline directement
 * embarqué (variant="inline"). Le gros du travail vit dans `EnrichPanel`.
 */
export function EnrichContactFromEmail({
  message,
  variant = "button",
  triggerLabel = "Enrichir le contact",
}: EnrichContactFromEmailProps) {
  const [open, setOpen] = useState(false);

  const extracted = useMemo(
    () => extractSignatureFields(message.bodyText ?? ""),
    [message.bodyText],
  );

  // Rien d'exploitable dans la signature → on n'affiche pas le déclencheur.
  if (!hasAnyExtractedField(extracted)) return null;

  if (variant === "inline") {
    return <EnrichPanel message={message} onDone={() => undefined} />;
  }

  return (
    <>
      <Button variant="ghost" size="sm" onPress={() => setOpen(true)}>
        {triggerLabel}
      </Button>
      <Modal
        isOpen={open}
        onOpenChange={(o) => setOpen(o)}
        title="Enrichir le contact"
        size="lg"
      >
        <EnrichPanel message={message} onDone={() => setOpen(false)} />
      </Modal>
    </>
  );
}

function EnrichPanel({
  message,
  onDone,
}: {
  message: EmailMessage;
  onDone: () => void;
}) {
  const { toast } = useToast();
  const email = message.from.email;

  const extracted = useMemo(
    () => extractSignatureFields(message.bodyText ?? ""),
    [message.bodyText],
  );

  // Liste des contacts pour la correspondance par email. Limite haute : la base
  // Contacts est typiquement petite ; on récupère tout en une fois.
  const { data, isLoading } = trpc.entities.list.useQuery({
    typeId: PERSONNE_TYPE_ID,
    limit: 10000,
    offset: 0,
  });

  const contacts = useMemo<ContactRow[]>(
    () => (data?.items ?? []).map((e) => ({ id: e.id, fields: e.fields })),
    [data],
  );

  const match = useMemo(
    () => findContactByEmail(contacts, email),
    [contacts, email],
  );

  const applications = useMemo(
    () => buildContactApplications(extracted, match?.fields ?? {}),
    [extracted, match],
  );

  // Sélection : par défaut, on coche les champs vides côté contact (sans
  // conflit). Les conflits restent décochés — l'utilisateur choisit d'écraser.
  // Recalculé quand la correspondance/les applications changent (la liste de
  // contacts arrive de façon asynchrone après le 1ᵉʳ rendu).
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const applicationsKey = applications.map((a) => `${a.fieldName}:${a.conflict}`).join("|");
  useEffect(() => {
    setSelected(Object.fromEntries(applications.map((a) => [a.fieldName, !a.conflict])));
    // applicationsKey capture l'identité fonctionnelle de `applications`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applicationsKey]);
  const [busy, setBusy] = useState(false);

  const { create, update } = useEntityMutations(PERSONNE_TYPE_ID);

  const toggle = (fieldName: string, checked: boolean) =>
    setSelected((s) => ({ ...s, [fieldName]: checked }));

  const selectedApps = applications.filter((a) => selected[a.fieldName]);

  const apply = async () => {
    if (selectedApps.length === 0) return;
    setBusy(true);
    try {
      const patch: Record<string, FieldValue> = {};
      for (const a of selectedApps) patch[a.fieldName] = a.extracted;

      if (match) {
        await update.mutateAsync({ id: match.id, fields: patch });
        toast({ title: "Contact mis à jour" });
      } else {
        // Création : on pré-remplit nom + email depuis l'expéditeur.
        const createFields: Record<string, FieldValue> = {
          name: message.from.name || email || "Sans nom",
          ...patch,
        };
        if (email) createFields.email = email;
        await create.mutateAsync({ typeId: PERSONNE_TYPE_ID, fields: createFields, body: "" });
        toast({ title: "Contact créé" });
      }
      onDone();
    } catch (err) {
      toast({
        title: "Échec de l'enrichissement",
        description: err instanceof Error ? err.message : String(err),
        variant: "danger",
      });
    } finally {
      setBusy(false);
    }
  };

  if (isLoading) {
    return (
      <p className="text-sm" style={{ color: "var(--text-muted)" }}>
        Chargement des contacts…
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* En-tête : qui + état de la correspondance */}
      <div className="flex flex-col gap-1">
        <span className="text-sm font-medium">{message.from.name || email || "Expéditeur"}</span>
        {email && (
          <span className="text-xs" style={{ color: "var(--text-muted)" }}>
            {email}
          </span>
        )}
        <div className="mt-1">
          {match ? (
            <Chip size="sm" variant="soft" color="success">
              Contact existant — mise à jour
            </Chip>
          ) : (
            <Chip size="sm" variant="soft" color="accent">
              Nouveau contact — création
            </Chip>
          )}
        </div>
      </div>

      {/* Champs extraits */}
      {applications.length === 0 ? (
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>
          Aucun champ exploitable détecté dans la signature.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {applications.map((a) => (
            <FieldRow
              key={a.fieldName}
              app={a}
              checked={!!selected[a.fieldName]}
              onToggle={(c) => toggle(a.fieldName, c)}
            />
          ))}
        </ul>
      )}

      {/* Actions */}
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button variant="ghost" size="sm" onPress={onDone} isDisabled={busy}>
          Annuler
        </Button>
        <Button
          size="sm"
          onPress={() => void apply()}
          isDisabled={busy || selectedApps.length === 0}
        >
          {busy
            ? "Application…"
            : match
              ? `Mettre à jour (${selectedApps.length})`
              : `Créer le contact (${selectedApps.length})`}
        </Button>
      </div>
    </div>
  );
}

function FieldRow({
  app,
  checked,
  onToggle,
}: {
  app: FieldApplication;
  checked: boolean;
  onToggle: (checked: boolean) => void;
}) {
  return (
    <li className="flex items-start gap-3">
      <Checkbox
        isSelected={checked}
        onChange={(isSel) => onToggle(Boolean(isSel))}
        // Cible tactile confortable sur mobile.
        className="mt-0.5"
        aria-label={`Appliquer ${app.label}`}
      />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium" style={{ color: "var(--text-muted)" }}>
            {app.label}
          </span>
          {app.conflict && (
            <Chip size="sm" variant="soft" color="warning">
              écrase
            </Chip>
          )}
        </div>
        <span className="text-sm break-words">{app.extracted}</span>
        {app.conflict && app.current && (
          <span className="text-xs line-through" style={{ color: "var(--text-muted)" }}>
            actuel : {app.current}
          </span>
        )}
      </div>
    </li>
  );
}
