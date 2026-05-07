"use client";

import { Robot, CircleNotch, CheckCircle, XCircle } from "@phosphor-icons/react";
import { useState } from "react";
import { useSettings } from "../SettingsContext";
import { SettingRow } from "../SettingRow";
import { SettingSection } from "../SettingSection";
import { NativeSelect } from "../NativeSelect";
import { ToggleSwitch } from "../ToggleSwitch";
import { RangeSlider } from "../RangeSlider";
import type { IaSettings } from "../types";
import { trpc } from "@/lib/trpc/client";

const FALLBACK_MODELS = [
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
    key: "autoTagging",
    label: "Auto-tagging",
    description: "Tagge automatiquement les notes sauvegardees via Ollama",
  },
  {
    key: "autoClassify",
    label: "Auto-classification",
    description: "Classe automatiquement les nouvelles notes par type",
  },
  {
    key: "mentionDetection",
    label: "Detection de mentions",
    description: "Detecte @personnes et #lieux dans le texte",
  },
  {
    key: "actionExtraction",
    label: "Extraction d'actions",
    description: "Identifie les taches et actions a faire",
  },
  {
    key: "dailyBrief",
    label: "Daily brief",
    description: "Resume quotidien de votre activite",
  },
  {
    key: "rag",
    label: "Recherche semantique (RAG)",
    description: "Recherche par sens dans vos notes",
  },
];

export function IaOllamaTab() {
  const { settings, updateSettings } = useSettings();
  const { ia } = settings;
  const [detecting, setDetecting] = useState(false);

  const updateIa = (patch: Partial<IaSettings>) =>
    updateSettings("ia", { ...ia, ...patch });

  // Live Ollama status query (runs once on mount)
  const statusQuery = trpc.system.ollamaStatus.useQuery(undefined, {
    retry: false,
    staleTime: 30_000,
  });

  const isAvailable = statusQuery.data?.available ?? false;
  const liveModels = statusQuery.data?.models.map((m) => m.name) ?? [];
  const modelOptions = (liveModels.length > 0 ? liveModels : FALLBACK_MODELS).map((m) => ({
    value: m,
    label: m,
  }));

  const detectOllama = async () => {
    setDetecting(true);
    await statusQuery.refetch();
    setDetecting(false);
  };

  return (
    <div className="space-y-6">
      <SettingSection
        title="IA & Ollama"
        description="Configuration de l'intelligence artificielle locale"
        icon={<Robot size={16} />}
      >
        {/* Ollama status banner */}
        <div
          className="flex items-center gap-2 rounded-lg border px-3 py-2 text-xs"
          style={{
            borderColor: isAvailable ? "var(--success-border, #86efac)" : "var(--border)",
            backgroundColor: isAvailable ? "var(--success-subtle, #f0fdf4)" : "var(--surface-2)",
            color: isAvailable ? "var(--success, #16a34a)" : "var(--text-muted)",
          }}
        >
          {statusQuery.isLoading ? (
            <CircleNotch size={13} className="animate-spin" />
          ) : isAvailable ? (
            <CheckCircle size={13} weight="fill" />
          ) : (
            <XCircle size={13} weight="fill" />
          )}
          <span>
            {statusQuery.isLoading
              ? "Verification Ollama..."
              : isAvailable
              ? `Ollama actif — ${liveModels.length} modele${liveModels.length !== 1 ? "s" : ""} disponible${liveModels.length !== 1 ? "s" : ""}`
              : "Ollama non detecte (lancez 'ollama serve')"}
          </span>
          <button
            onClick={detectOllama}
            disabled={detecting || statusQuery.isLoading}
            className="ml-auto flex items-center gap-1 rounded border px-2 py-0.5 transition-all hover:opacity-80 disabled:opacity-50"
            style={{ borderColor: "var(--border)", color: "var(--text-secondary)", backgroundColor: "var(--surface-1)" }}
          >
            {detecting && <CircleNotch size={11} className="animate-spin" />}
            Rafraichir
          </button>
        </div>

        <SettingRow label="Activer l'IA" description="Active ou desactive tous les modules IA">
          <ToggleSwitch
            checked={ia.autoTagging || ia.autoClassify}
            onChange={(v) => updateIa({ autoTagging: v, autoClassify: v })}
          />
        </SettingRow>

        <SettingRow label="Modele Ollama">
          <NativeSelect
            value={ia.ollamaModel}
            onChange={(v) => updateIa({ ollamaModel: v })}
            options={modelOptions}
          />
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
        title="Fonctionnalites IA"
        description="Activez ou desactivez chaque module"
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
