"use client";

/**
 * NewItemSheet — sélecteur « Créer » du FAB mobile. Quand Google Drive est
 * connecté, le FAB n'a plus une action unique (nouvelle note) mais ouvre cette
 * feuille listant Note + Google Doc/Sheet/Slides. Sur desktop, ces mêmes
 * options vivent dans le menu contextuel de dossier et l'éditeur vide.
 */

import { Button, Modal } from "@supernote/ui";
import { FileText } from "@phosphor-icons/react";

import { GOOGLE_DOC_KINDS, type GoogleDocKind } from "@/lib/google-drive";
import { DRIVE_DOC_ICONS, DRIVE_DOC_ORDER, type IconComponent } from "./driveDocMeta";

interface NewItemSheetProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  /** Crée une note markdown classique. */
  onNewNote: () => void;
  /** Crée un fichier Google Workspace du type donné. */
  onNewDriveDoc: (kind: GoogleDocKind) => void;
}

export function NewItemSheet({
  isOpen,
  onOpenChange,
  onNewNote,
  onNewDriveDoc,
}: NewItemSheetProps) {
  // Ferme la feuille AVANT de déclencher l'action (qui ouvre un prompt /
  // navigue) — sinon le modal reste empilé par-dessus.
  const pick = (run: () => void) => {
    onOpenChange(false);
    run();
  };

  return (
    <Modal isOpen={isOpen} onOpenChange={onOpenChange} title="Créer" size="sm">
      <div className="flex flex-col gap-2">
        <SheetRow icon={FileText} label="Note" onPress={() => pick(onNewNote)} />
        {DRIVE_DOC_ORDER.map((kind) => (
          <SheetRow
            key={kind}
            icon={DRIVE_DOC_ICONS[kind]}
            label={GOOGLE_DOC_KINDS[kind].label}
            onPress={() => pick(() => onNewDriveDoc(kind))}
          />
        ))}
      </div>
    </Modal>
  );
}

function SheetRow({
  icon: Icon,
  label,
  onPress,
}: {
  icon: IconComponent;
  label: string;
  onPress: () => void;
}) {
  return (
    <Button
      type="button"
      variant="outline"
      onClick={onPress}
      className="flex w-full items-center justify-start gap-3 px-4 py-3 text-sm"
    >
      <Icon size={20} />
      {label}
    </Button>
  );
}
