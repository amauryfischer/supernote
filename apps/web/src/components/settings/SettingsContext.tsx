"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import type { AppSettings } from "./types";
import { DEFAULT_SETTINGS } from "./defaults";

interface SettingsContextValue {
  settings: AppSettings;
  updateSettings: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void;
  saveSettings: () => Promise<void>;
  isSaving: boolean;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

const STORAGE_KEY = "supernote.settings";

/** Hydrate from localStorage on mount; returns DEFAULT_SETTINGS otherwise.
 *  Lazy initializer so we only hit storage once. */
function loadInitialSettings(): AppSettings {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    // Defensive merge: any missing slot falls back to the default. Protects
    // against schema bumps where a new section was added after the user's
    // last save.
    // Defensive merge per nested-object slot. Arrays (plugins, shortcuts)
    // are replaced wholesale so the user's persisted set wins; nested
    // objects fall back to defaults for any missing key.
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
      general: { ...DEFAULT_SETTINGS.general, ...(parsed.general ?? {}) },
      appearance: { ...DEFAULT_SETTINGS.appearance, ...(parsed.appearance ?? {}) },
      ia: { ...DEFAULT_SETTINGS.ia, ...(parsed.ia ?? {}) },
      sync: { ...DEFAULT_SETTINGS.sync, ...(parsed.sync ?? {}) },
      api: { ...DEFAULT_SETTINGS.api, ...(parsed.api ?? {}) },
      notifications: { ...DEFAULT_SETTINGS.notifications, ...(parsed.notifications ?? {}) },
      plugins: parsed.plugins ?? DEFAULT_SETTINGS.plugins,
      shortcuts: parsed.shortcuts ?? DEFAULT_SETTINGS.shortcuts,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<AppSettings>(loadInitialSettings);
  const [isSaving, setIsSaving] = useState(false);

  // Persist on every change so the user's preferences (date format, theme,
  // etc.) survive reloads — and propagate across pages without a tRPC
  // round-trip. Cheap; localStorage writes are sub-millisecond.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch {
      /* quota / disabled storage — best-effort */
    }
  }, [settings]);

  const updateSettings = useCallback(
    <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
      setSettings((prev) => ({ ...prev, [key]: value }));
    },
    [],
  );

  const saveSettings = useCallback(async () => {
    setIsSaving(true);
    // In real app: await trpc.settings.set.mutate(settings)
    // Local persistence already happened in the useEffect above; this stub
    // keeps the legacy "Save" button happy and gives visual feedback.
    await new Promise((r) => setTimeout(r, 400));
    setIsSaving(false);
  }, []);

  return (
    <SettingsContext.Provider value={{ settings, updateSettings, saveSettings, isSaving }}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings() {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error("useSettings must be used within SettingsProvider");
  return ctx;
}
