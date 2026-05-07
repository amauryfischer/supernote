"use client";

import { createContext, useContext, useState, useCallback, type ReactNode } from "react";
import type { AppSettings } from "./types";
import { DEFAULT_SETTINGS } from "./defaults";

interface SettingsContextValue {
  settings: AppSettings;
  updateSettings: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void;
  saveSettings: () => Promise<void>;
  isSaving: boolean;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [isSaving, setIsSaving] = useState(false);

  const updateSettings = useCallback(
    <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
      setSettings((prev) => ({ ...prev, [key]: value }));
    },
    [],
  );

  const saveSettings = useCallback(async () => {
    setIsSaving(true);
    // In real app: await trpc.settings.set.mutate(settings)
    await new Promise((r) => setTimeout(r, 400));
    setIsSaving(false);
  }, [settings]);

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
