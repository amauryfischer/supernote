"use client";

import { Modal } from "@supernote/ui";
import { EmailPicker } from "@/components/mail/EmailPicker";

/** Modal de sélection d'un email — enveloppe EmailPicker pour le bloc embed. */
export function GmailPickerModal({
  isOpen,
  onSelect,
  onClose,
}: {
  isOpen: boolean;
  onSelect: (threadId: string) => void;
  onClose: () => void;
}) {
  return (
    <Modal
      isOpen={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title="Choisir un email"
      size="lg"
    >
      <EmailPicker onSelect={onSelect} />
    </Modal>
  );
}
