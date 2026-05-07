"use client";

import { FolderOpen } from "@phosphor-icons/react";
import { useSettings } from "../SettingsContext";
import { SettingRow } from "../SettingRow";
import { SettingSection } from "../SettingSection";
import { NativeSelect } from "../NativeSelect";
import { useTranslations } from "next-intl";
import { useLocale } from "@/i18n/LocaleProvider";
import type { Locale } from "@/i18n/config";

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

  const LANGUAGES: Array<{ value: string; label: string }> = [
    { value: "fr", label: t("settings.languages.fr") },
    { value: "en", label: t("settings.languages.en") },
  ];

  function handleLanguageChange(v: string) {
    const next = v as Locale;
    setLocale(next);
    updateSettings("general", { ...general, language: next });
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
              <span className="truncate font-mono text-xs">{general.vaultPath}</span>
            </div>
            <button
              className="rounded-md border px-3 py-1.5 text-sm transition-all hover:opacity-80"
              style={{
                borderColor: "var(--border)",
                color: "var(--text-secondary)",
                backgroundColor: "var(--surface-1)",
              }}
            >
              {t("settings.general.change")}
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
    </div>
  );
}
