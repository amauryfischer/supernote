"use client";

import { useRouter } from "next/navigation";
import { Button, Modal } from "@supernote/ui";
import { useApplyTemplate } from "./useApplyTemplate";
import { useTemplateList } from "./useTemplateList";

interface TemplatePickerModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Choix du modèle puis création de la note (questions `{{prompt:…}}` comprises). */
export function TemplatePickerModal({ isOpen, onOpenChange }: TemplatePickerModalProps) {
  const router = useRouter();
  const { apply, modal } = useApplyTemplate();
  const { hasBackend, templates, isLoading, error } = useTemplateList(isOpen);

  const goToTemplates = () => {
    onOpenChange(false);
    router.push("/templates");
  };

  const status = !hasBackend
    ? "Ouvrez un coffre pour utiliser des modèles."
    : isLoading
      ? "Chargement des modèles…"
      : error
        ? `Impossible de charger les modèles : ${error}`
        : templates.length === 0
          ? "Aucun modèle pour l'instant."
          : null;

  return (
    <>
      <Modal isOpen={isOpen} onOpenChange={onOpenChange} title="Nouvelle note depuis un modèle" size="sm">
        <div className="flex max-h-[60dvh] flex-col gap-2 overflow-y-auto">
          {status ? (
            <p className="px-1 py-2 text-sm" style={{ color: error ? "var(--danger)" : "var(--text-muted)" }}>
              {status}
            </p>
          ) : (
            templates.map((t) => (
              <Button
                key={t.id}
                type="button"
                variant="outline"
                onClick={() => {
                  // Ferme avant d'appliquer : les questions du modèle s'ouvrent par-dessus sinon.
                  onOpenChange(false);
                  apply(t);
                }}
                className="flex h-auto min-h-11 w-full flex-col items-start gap-0.5 px-4 py-2.5 text-left"
              >
                <span className="w-full truncate text-sm font-medium">{t.name}</span>
                {t.description && (
                  <span className="w-full truncate text-xs" style={{ color: "var(--text-muted)" }}>
                    {t.description}
                  </span>
                )}
              </Button>
            ))
          )}
          {hasBackend && (
            <Button type="button" variant="ghost" onClick={goToTemplates} className="min-h-9 self-start text-xs">
              Gérer les modèles
            </Button>
          )}
        </div>
      </Modal>
      {modal}
    </>
  );
}
