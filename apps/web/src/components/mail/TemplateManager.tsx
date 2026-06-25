"use client";

import { useEffect, useState } from "react";
import { Modal, Button, Input, Textarea, useToast } from "@supernote/ui";
import { Trash, Plus, EnvelopeSimple, Signature } from "@phosphor-icons/react";
import {
  createTemplate,
  type MailTemplate,
  type MailTemplateKind,
} from "@/lib/mail-templates";

/**
 * Gestion CRUD des modèles d'email (modal). Contrôlé : l'état des templates vit
 * chez le parent (`useMailTemplates`) pour rester partagé avec le picker.
 * Liste à gauche, éditeur à droite (empilé sur mobile).
 */
export function TemplateManager({
  isOpen,
  onClose,
  templates,
  onUpsert,
  onRemove,
}: {
  isOpen: boolean;
  onClose: () => void;
  templates: MailTemplate[];
  onUpsert: (t: MailTemplate) => void;
  onRemove: (id: string) => void;
}) {
  const { toast } = useToast();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<MailTemplate | null>(null);

  // Synchronise le brouillon d'édition avec la sélection courante.
  useEffect(() => {
    if (selectedId === null) {
      setDraft(null);
      return;
    }
    const t = templates.find((x) => x.id === selectedId);
    setDraft(t ? { ...t } : null);
  }, [selectedId, templates]);

  const handleNew = (kind: MailTemplateKind) => {
    const t = createTemplate(kind);
    onUpsert(t);
    setSelectedId(t.id);
  };

  const handleSave = () => {
    if (!draft) return;
    if (!draft.name.trim()) {
      toast({ title: "Donne un nom au modèle", variant: "danger" });
      return;
    }
    onUpsert(draft);
    toast({ title: "Modèle enregistré" });
  };

  const handleDelete = (id: string) => {
    onRemove(id);
    if (selectedId === id) setSelectedId(null);
  };

  return (
    <Modal
      isOpen={isOpen}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title="Modèles d'email"
      size="xl"
    >
      <div className="flex flex-col gap-4 md:flex-row">
        {/* Liste */}
        <div className="flex w-full shrink-0 flex-col gap-2 md:w-56">
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" onPress={() => handleNew("email")} className="flex-1">
              <Plus size={14} /> Email
            </Button>
            <Button size="sm" variant="ghost" onPress={() => handleNew("signature")} className="flex-1">
              <Plus size={14} /> Signature
            </Button>
          </div>
          <div className="flex max-h-72 flex-col gap-1 overflow-y-auto">
            {templates.length === 0 && (
              <p className="px-1 py-2 text-xs" style={{ color: "var(--text-muted)" }}>
                Aucun modèle. Crée-en un.
              </p>
            )}
            {templates.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setSelectedId(t.id)}
                className="flex items-center gap-2 rounded-[var(--radius-md)] px-2 py-1.5 text-left text-sm"
                style={{
                  background: t.id === selectedId ? "var(--surface-2)" : "transparent",
                  color: "var(--text-primary)",
                }}
              >
                {t.kind === "signature" ? (
                  <Signature size={14} style={{ color: "var(--text-muted)" }} />
                ) : (
                  <EnvelopeSimple size={14} style={{ color: "var(--text-muted)" }} />
                )}
                <span className="truncate">{t.name || "(sans nom)"}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Éditeur */}
        <div className="min-w-0 flex-1">
          {!draft ? (
            <div className="flex h-full min-h-40 items-center justify-center">
              <p className="text-sm" style={{ color: "var(--text-muted)" }}>
                Sélectionne ou crée un modèle.
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-1">
                <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                  Nom
                </span>
                <Input
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  placeholder="Nom du modèle"
                />
              </div>

              {draft.kind === "email" && (
                <div className="flex flex-col gap-1">
                  <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                    Objet
                  </span>
                  <Input
                    value={draft.subject ?? ""}
                    onChange={(e) => setDraft({ ...draft, subject: e.target.value })}
                    placeholder="Objet de l'email"
                  />
                </div>
              )}

              <div className="flex flex-col gap-1">
                <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                  {draft.kind === "signature" ? "Signature" : "Corps"}
                </span>
                <Textarea
                  value={draft.body}
                  onChange={(e) => setDraft({ ...draft, body: e.target.value })}
                  rows={draft.kind === "signature" ? 4 : 8}
                  placeholder={draft.kind === "signature" ? "Jean Dupont\n01 23 45 67 89" : "Contenu de l'email…"}
                />
              </div>

              <div className="flex items-center justify-between gap-2">
                <Button
                  size="sm"
                  variant="ghost"
                  onPress={() => handleDelete(draft.id)}
                  className="text-[var(--color-danger)]"
                >
                  <Trash size={14} /> Supprimer
                </Button>
                <Button variant="primary" onPress={handleSave}>
                  Enregistrer
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
