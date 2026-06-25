"use client";

import { Button, DropdownMenu, type DropdownMenuSection } from "@supernote/ui";
import { CaretDown, EnvelopeSimple, Signature } from "@phosphor-icons/react";
import type { MailTemplate } from "@/lib/mail-templates";

/**
 * Insertion rapide d'un modèle au compose. Dropdown groupé par type
 * (emails / signatures). `onInsert` reçoit le template choisi ; l'appelant
 * applique `applyTemplate` sur le brouillon courant.
 */
export function TemplatePicker({
  templates,
  onInsert,
}: {
  templates: MailTemplate[];
  onInsert: (t: MailTemplate) => void;
}) {
  if (templates.length === 0) {
    return (
      <Button size="sm" variant="ghost" isDisabled>
        Aucun modèle
      </Button>
    );
  }

  const emails = templates.filter((t) => t.kind === "email");
  const signatures = templates.filter((t) => t.kind === "signature");

  const sections: DropdownMenuSection[] = [];
  if (emails.length) {
    sections.push({
      key: "emails",
      title: "Emails",
      items: emails.map((t) => ({
        key: t.id,
        label: t.name || "(sans nom)",
        startContent: <EnvelopeSimple size={14} />,
      })),
    });
  }
  if (signatures.length) {
    sections.push({
      key: "signatures",
      title: "Signatures",
      items: signatures.map((t) => ({
        key: t.id,
        label: t.name || "(sans nom)",
        startContent: <Signature size={14} />,
      })),
    });
  }

  const onAction = (key: string) => {
    const t = templates.find((x) => x.id === key);
    if (t) onInsert(t);
  };

  return (
    <DropdownMenu
      trigger={
        <Button size="sm" variant="ghost">
          Insérer un modèle <CaretDown size={14} />
        </Button>
      }
      sections={sections}
      onAction={onAction}
    />
  );
}
