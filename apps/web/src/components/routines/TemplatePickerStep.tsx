"use client";

import { Calendar, Lightning, Alarm, Brain, Plus } from "@phosphor-icons/react";
import type { TemplateKey } from "./fixtures";
import { TEMPLATE_META } from "./fixtures";

interface TemplatePickerStepProps {
  onSelect: (key: TemplateKey) => void;
}

const TEMPLATE_ICONS: Record<TemplateKey, React.ElementType> = {
  "weekly-email": Lightning,
  "birthday-reminder": Alarm,
  "follow-up": Calendar,
  "daily-brief": Brain,
  blank: Plus,
};

const TEMPLATE_ORDER: TemplateKey[] = [
  "weekly-email",
  "birthday-reminder",
  "follow-up",
  "daily-brief",
  "blank",
];

export function TemplatePickerStep({ onSelect }: TemplatePickerStepProps) {
  return (
    <div>
      <h2 className="mb-1 text-base font-semibold" style={{ color: "var(--text-primary)" }}>
        Choisir un modèle
      </h2>
      <p className="mb-6 text-sm" style={{ color: "var(--text-muted)" }}>
        Sélectionnez un template pour préremplir la configuration, ou partez de zéro.
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {TEMPLATE_ORDER.map((key) => {
          const meta = TEMPLATE_META[key];
          const Icon = TEMPLATE_ICONS[key];
          const isBlank = key === "blank";
          return (
            <button
              key={key}
              onClick={() => onSelect(key)}
              className="flex items-start gap-3 rounded-xl border p-4 text-left transition-all hover:border-[var(--accent)] hover:shadow-sm"
              style={{
                borderColor: "var(--border)",
                backgroundColor: "var(--surface-1)",
              }}
            >
              <div
                className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg"
                style={{
                  backgroundColor: isBlank ? "var(--surface-3)" : "var(--accent-subtle)",
                }}
              >
                <Icon size={20} style={{ color: isBlank ? "var(--text-muted)" : "var(--accent)" }} />
              </div>
              <div>
                <div className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                  {meta.label}
                </div>
                <div className="mt-0.5 text-xs leading-relaxed" style={{ color: "var(--text-muted)" }}>
                  {meta.description}
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
