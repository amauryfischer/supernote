"use client";

import { Robot, CircleNotch } from "@phosphor-icons/react";
import { useState } from "react";
import { useSettings } from "../SettingsContext";
import { SettingRow } from "../SettingRow";
import { SettingSection } from "../SettingSection";
import { NativeSelect } from "../NativeSelect";
import { ToggleSwitch } from "../ToggleSwitch";
import { RangeSlider } from "../RangeSlider";
import type { IaSettings } from "../types";

const OLLAMA_MODELS = [
  "llama3.2",
  "llama3.2:1b",
  "llama3.1",
  "mistral",
  "mistral-nemo",
  "phi3",
  "gemma2",
  "qwen2.5",
];

const AI_FEATURES: Array<{
  key: keyof IaSettings;
  label: string;
  description: string;
}> = [
  {
    key: "autoClassify",
    label: "Auto-classification",
    description: "Classe automatiquement les nouvelles notes par type",
  },
  {
    key: "mentionDetection",
    label: "Détection de mentions",
    description: "Détecte @personnes et #lieux dans le texte",
  },
  {
    key: "actionExtraction",
    label: "Extraction d'actions",
    description: "Identifie les tâches et actions à faire",
  },
  {
    key: "dailyBrief",
    label: "Daily brief",
    description: "Résumé quotidien de votre activité",
  },
  {
    key: "rag",
    label: "Recherche sémantique (RAG)",
    description: "Recherche par sens dans vos notes",
  },
];

export function IaOllamaTab() {
  const { settings, updateSettings } = useSettings();
  const { ia } = settings;
  const [detecting, setDetecting] = useState(false);

  const updateIa = (patch: Partial<IaSettings>) =>
    updateSettings("ia", { ...ia, ...patch });

  const detectOllama = async () => {
    setDetecting(true);
    await new Promise((r) => setTimeout(r, 800));
    setDetecting(false);
  };

  return (
    <div className="space-y-6">
      <SettingSection
        title="IA & Ollama"
        description="Configuration de l'intelligence artificielle locale"
        icon={<Robot size={16} />}
      >
        <SettingRow label="Auto-tagging" description="Activer le tagging automatique des notes">
          <ToggleSwitch
            checked={ia.autoTagging}
            onChange={(v) => updateIa({ autoTagging: v })}
          />
        </SettingRow>

        <SettingRow label="Modèle Ollama">
          <div className="flex items-center gap-2">
            <NativeSelect
              value={ia.ollamaModel}
              onChange={(v) => updateIa({ ollamaModel: v })}
              options={OLLAMA_MODELS.map((m) => ({ value: m, label: m }))}
            />
            <button
              onClick={detectOllama}
              className="flex items-center gap-1 rounded-md border px-3 py-1.5 text-xs transition-all hover:opacity-80"
              style={{ borderColor: "var(--border)", color: "var(--text-secondary)", backgroundColor: "var(--surface-1)" }}
            >
              {detecting && <CircleNotch size={12} className="animate-spin" />}
              Détecter
            </button>
          </div>
        </SettingRow>

        <SettingRow
          label="Seuil de confiance"
          description={`${Math.round(ia.confidenceThreshold * 100)}%`}
        >
          <RangeSlider
            min={0.1}
            max={1}
            step={0.05}
            value={ia.confidenceThreshold}
            onChange={(v) => updateIa({ confidenceThreshold: v })}
          />
        </SettingRow>
      </SettingSection>

      <SettingSection
        title="Fonctionnalités IA"
        description="Activez ou désactivez chaque module"
      >
        {AI_FEATURES.map(({ key, label, description }) => (
          <SettingRow key={key} label={label} description={description}>
            <ToggleSwitch
              checked={ia[key] as boolean}
              onChange={(v) => updateIa({ [key]: v })}
            />
          </SettingRow>
        ))}
      </SettingSection>
    </div>
  );
}
