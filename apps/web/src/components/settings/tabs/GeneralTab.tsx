"use client";

import { FolderOpen } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { useSettings } from "../SettingsContext";
import { SettingRow } from "../SettingRow";
import { SettingSection } from "../SettingSection";
import { NativeSelect } from "../NativeSelect";
import { useTranslations } from "next-intl";
import { useLocale } from "@/i18n/LocaleProvider";
import type { Locale } from "@/i18n/config";
import { useVault } from "@/lib/pwa/PwaVaultSetup";
import { readDefaultEmail, writeDefaultEmail } from "@/components/todos/EmailComposer";

const DATE_FORMATS: Array<{ value: string; label: string }> = [
  { value: "DD/MM/YYYY", label: "DD/MM/YYYY" },
  { value: "MM/DD/YYYY", label: "MM/DD/YYYY" },
  { value: "YYYY-MM-DD", label: "YYYY-MM-DD (ISO)" },
];

const TIMEZONES: Array<{ value: string; label: string }> = [
  { value: "Europe/Paris", label: "Europe/Paris (CET)" },
  { value: "America/New_York", label: "America/New York (EST)" },
  { value: "America/Los_Angeles", label: "America/Los Angeles (PST)" },
  { value: "UTC", label: "UTC" },
];

export function GeneralTab() {
  const { settings, updateSettings } = useSettings();
  const { general } = settings;
  const t = useTranslations();
  const { locale, setLocale } = useLocale();
  const vault = useVault();
  // In PWA mode the live vault name comes from the worker; in Electron we
  // fall back to the persisted setting path.
  const displayedVaultPath =
    vault?.isPwa && vault.vaultName ? vault.vaultName : general.vaultPath;
  const canChangeVault = Boolean(vault?.isPwa);
  const isPicking = vault?.state === "picking" || vault?.state === "loading";

  const LANGUAGES: Array<{ value: string; label: string }> = [
    { value: "fr", label: t("settings.languages.fr") },
    { value: "en", label: t("settings.languages.en") },
  ];

  function handleLanguageChange(v: string) {
    const next = v as Locale;
    setLocale(next);
    updateSettings("general", { ...general, language: next });
  }

  // Default email for the /todos email-export buttons. Stored in
  // localStorage (not the SettingsContext) because EmailComposer needs to
  // read it from non-React paths (e.g. when assembling a `mailto:` URL on
  // a button click outside of the settings tree).
  const [defaultEmail, setDefaultEmail] = useState("");
  useEffect(() => {
    setDefaultEmail(readDefaultEmail());
  }, []);
  function persistDefaultEmail(v: string) {
    setDefaultEmail(v);
    writeDefaultEmail(v);
  }

  return (
    <div className="space-y-6">
      <SettingSection
        title={t("settings.general.vault")}
        description={t("settings.general.vaultDescription")}
      >
        <SettingRow label={t("settings.general.vaultPath")}>
          <div className="flex items-center gap-2">
            <div
              className="flex flex-1 items-center gap-2 rounded-md border px-3 py-1.5 text-sm"
              style={{
                borderColor: "var(--border)",
                backgroundColor: "var(--surface-1)",
                color: "var(--text-secondary)",
              }}
            >
              <FolderOpen size={14} style={{ color: "var(--text-muted)" }} />
              <span className="truncate font-mono text-xs">{displayedVaultPath}</span>
            </div>
            <button
              type="button"
              onClick={canChangeVault ? () => void vault?.pickFolder() : undefined}
              disabled={!canChangeVault || isPicking}
              className="rounded-md border px-3 py-1.5 text-sm transition-all hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-50"
              style={{
                borderColor: "var(--border)",
                color: "var(--text-secondary)",
                backgroundColor: "var(--surface-1)",
              }}
              title={
                canChangeVault
                  ? t("settings.general.change")
                  : "Disponible uniquement en mode navigateur (PWA)"
              }
            >
              {isPicking ? "..." : t("settings.general.change")}
            </button>
          </div>
        </SettingRow>
      </SettingSection>

      <SettingSection
        title={t("settings.general.localization")}
        description={t("settings.general.localizationDescription")}
      >
        <SettingRow label={t("settings.general.language")}>
          <NativeSelect
            value={locale}
            onChange={handleLanguageChange}
            options={LANGUAGES}
          />
        </SettingRow>

        <SettingRow label={t("settings.general.timezone")}>
          <NativeSelect
            value={general.timezone}
            onChange={(v) => updateSettings("general", { ...general, timezone: v })}
            options={TIMEZONES}
          />
        </SettingRow>

        <SettingRow label={t("settings.general.dateFormat")}>
          <NativeSelect
            value={general.dateFormat}
            onChange={(v) => updateSettings("general", { ...general, dateFormat: v })}
            options={DATE_FORMATS}
          />
        </SettingRow>
      </SettingSection>

      {/* Email export defaults — used by the /todos "📧 Envoyer" buttons. */}
      <SettingSection
        title="Export par email"
        description="Adresse pré-remplie quand vous envoyez une tâche par email depuis /todos."
      >
        <SettingRow label="Adresse par défaut">
          <input
            type="email"
            value={defaultEmail}
            onChange={(e) => persistDefaultEmail(e.target.value)}
            placeholder="vous@exemple.fr"
            className="w-full rounded-md border px-3 py-1.5 text-sm outline-none transition-colors"
            style={{
              borderColor: "var(--border)",
              backgroundColor: "var(--surface-1)",
              color: "var(--text-primary)",
            }}
          />
        </SettingRow>
      </SettingSection>
    </div>
  );
}
