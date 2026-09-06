/**
 * Read AI / Ollama settings from localStorage (same shape as
 * `apps/web/src/components/settings/types.ts::IaSettings`). Falls back to
 * the defaults defined in `defaults.ts` when nothing is persisted yet.
 *
 * Kept dependency-free on purpose so it can be imported from anywhere
 * (worker, UI, agent loop) without dragging React.
 */

import { DEFAULT_SETTINGS } from "@/components/settings/defaults";
import type { IaSettings } from "@/components/settings/types";

// DOIT correspondre à la clé de SettingsContext (`supernote.settings`). Un
// ancien `…v1` ici lisait une clé inexistante → `getAiSettings()` retombait
// TOUJOURS sur le modèle par défaut, ignorant le modèle choisi
// dans les réglages → IA « ne marche pas » même si Ollama tourne.
const STORAGE_KEY = "supernote.settings";

export interface AiRuntimeSettings {
  baseUrl: string;
  model: string;
}

const DEFAULT_BASE_URL = "http://127.0.0.1:11434";

function readPersistedIa(): IaSettings {
  if (typeof window === "undefined") return DEFAULT_SETTINGS.ia;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS.ia;
    const parsed = JSON.parse(raw) as Partial<{ ia: Partial<IaSettings> }>;
    return { ...DEFAULT_SETTINGS.ia, ...(parsed.ia ?? {}) };
  } catch {
    return DEFAULT_SETTINGS.ia;
  }
}

/**
 * Returns the Ollama config the agent / chat UI should use. The base URL
 * is currently hardcoded to the default Ollama port — once the settings
 * page exposes a `ollamaBaseUrl` field we'll surface it here too.
 */
export function getAiSettings(): AiRuntimeSettings {
  const ia = readPersistedIa();
  return {
    baseUrl: DEFAULT_BASE_URL,
    model: ia.ollamaModel,
  };
}
