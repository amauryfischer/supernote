"use client";

import { X, EnvelopeSimple, FileText, PencilSimple, Link as LinkIcon, Bell, BellRinging, Globe, Brain, Code, Tray } from "@phosphor-icons/react";
import type { ActionType } from "./fixtures";

interface ActionPickerModalProps {
  open: boolean;
  onClose: () => void;
  onSelect: (type: ActionType) => void;
}

interface ActionOption {
  type: ActionType;
  label: string;
  description: string;
  icon: React.ElementType;
}

const ACTION_OPTIONS: ActionOption[] = [
  { type: "create-mail-draft", label: "Brouillon email", description: "Créé un brouillon dans la boite mail", icon: EnvelopeSimple },
  { type: "create-inbox-note", label: "Note inbox", description: "Ajoute une note dans l'inbox", icon: Tray },
  { type: "notify-app", label: "Notification app", description: "Affiche une notification dans l'app", icon: Bell },
  { type: "notify-os", label: "Notification OS", description: "Notification système native", icon: BellRinging },
  { type: "llm-prompt", label: "Prompt IA", description: "Envoie un prompt à Ollama / LLM", icon: Brain },
  { type: "webhook", label: "Webhook HTTP", description: "Appel HTTP vers une URL externe", icon: Globe },
  { type: "create-entity", label: "Créer entité", description: "Crée une nouvelle entité dans la base", icon: FileText },
  { type: "update-entity", label: "Modifier entité", description: "Met à jour les champs d'une entité", icon: PencilSimple },
  { type: "create-relation", label: "Créer relation", description: "Lie deux entités entre elles", icon: LinkIcon },
  { type: "run-script", label: "Script JS", description: "Exécute un script JavaScript personnalisé", icon: Code },
];

export function ActionPickerModal({ open, onClose, onSelect }: ActionPickerModalProps) {
  if (!open) return null;

  function handleSelect(type: ActionType) {
    onSelect(type);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0"
        style={{ backgroundColor: "oklch(0 0 0 / 0.35)" }}
        onClick={onClose}
      />

      {/* Modal */}
      <div
        className="relative z-10 w-full max-w-md rounded-xl border shadow-xl"
        style={{ backgroundColor: "var(--surface-0)", borderColor: "var(--border)" }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between border-b px-5 py-4"
          style={{ borderColor: "var(--border-subtle)" }}
        >
          <h2 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
            Choisir une action
          </h2>
          <button
            onClick={onClose}
            className="rounded p-1 transition-colors hover:bg-[var(--surface-2)]"
            style={{ color: "var(--text-muted)" }}
          >
            <X size={15} />
          </button>
        </div>

        {/* Action grid */}
        <div className="grid grid-cols-2 gap-2 p-4">
          {ACTION_OPTIONS.map((opt) => {
            const Icon = opt.icon;
            return (
              <button
                key={opt.type}
                onClick={() => handleSelect(opt.type)}
                className="flex items-start gap-2.5 rounded-lg border p-3 text-left transition-colors hover:bg-[var(--surface-2)]"
                style={{ borderColor: "var(--border-subtle)" }}
              >
                <div
                  className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md"
                  style={{ backgroundColor: "var(--accent-subtle)" }}
                >
                  <Icon size={14} style={{ color: "var(--accent)" }} />
                </div>
                <div>
                  <div className="text-xs font-medium" style={{ color: "var(--text-primary)" }}>
                    {opt.label}
                  </div>
                  <div className="mt-0.5 text-[10px] leading-tight" style={{ color: "var(--text-muted)" }}>
                    {opt.description}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
