"use client";

import { useTheme } from "next-themes";
import { Button } from "@heroui/react";
import { useSettings } from "../SettingsContext";
import { SettingRow } from "../SettingRow";
import { SettingSection } from "../SettingSection";
import { ACCENT_COLORS } from "../defaults";
import { useTranslations } from "next-intl";

type Theme = "light" | "dark" | "system";
type Density = "compact" | "normal" | "spacious";
type CodeFont = "sans" | "mono";

export function AppearanceTab() {
  const { theme, setTheme } = useTheme();
  const { settings, updateSettings } = useSettings();
  const { appearance } = settings;
  const t = useTranslations("settings.appearance");

  const handleAccent = (color: string) =>
    updateSettings("appearance", { ...appearance, accentColor: color });

  const handleDensity = (d: Density) =>
    updateSettings("appearance", { ...appearance, density: d });

  const handleCodeFont = (f: CodeFont) =>
    updateSettings("appearance", { ...appearance, codeFont: f });

  const THEME_LABELS: Record<Theme, string> = {
    light: t("themeLight"),
    dark: t("themeDark"),
    system: t("themeSystem"),
  };

  const DENSITY_LABELS: Record<Density, string> = {
    compact: t("densityCompact"),
    normal: t("densityNormal"),
    spacious: t("densitySpacious"),
  };

  return (
    <div className="space-y-6">
      <SettingSection title={t("theme")} description={t("themeDescription")}>
        <SettingRow label={t("displayMode")}>
          <div className="flex gap-2">
            {(["light", "dark", "system"] as const).map((th) => (
              <Button
                key={th}
                variant="ghost"
                size="sm"
                onPress={() => setTheme(th)}
                className="rounded-md border px-3 py-1.5 text-sm transition-all"
                style={{
                  borderColor: theme === th ? "var(--accent)" : "var(--border)",
                  backgroundColor: theme === th ? "var(--accent-subtle)" : "transparent",
                  color: theme === th ? "var(--accent)" : "var(--text-secondary)",
                  fontWeight: theme === th ? 500 : 400,
                }}
              >
                {THEME_LABELS[th]}
              </Button>
            ))}
          </div>
        </SettingRow>
      </SettingSection>

      <SettingSection title={t("accentColor")} description={t("accentColorDescription")}>
        <SettingRow label={t("palette")}>
          <div className="flex flex-wrap gap-2">
            {ACCENT_COLORS.map((color) => (
              <Button
                key={color.value}
                isIconOnly
                variant="ghost"
                size="sm"
                aria-label={color.label}
                onPress={() => handleAccent(color.value)}
                className="h-7 w-7 min-w-0 rounded-full p-0 transition-all"
                style={{
                  backgroundColor: color.value,
                  outline:
                    appearance.accentColor === color.value
                      ? `2px solid ${color.value}`
                      : "2px solid transparent",
                  outlineOffset: "2px",
                }}
              />
            ))}
          </div>
        </SettingRow>
      </SettingSection>

      <SettingSection title={t("density")} description={t("densityDescription")}>
        <SettingRow label={t("layout")}>
          <div className="flex gap-2">
            {(["compact", "normal", "spacious"] as const).map((d) => (
              <Button
                key={d}
                variant="ghost"
                size="sm"
                onPress={() => handleDensity(d)}
                className="rounded-md border px-3 py-1.5 text-sm transition-all"
                style={{
                  borderColor: appearance.density === d ? "var(--accent)" : "var(--border)",
                  backgroundColor:
                    appearance.density === d ? "var(--accent-subtle)" : "transparent",
                  color: appearance.density === d ? "var(--accent)" : "var(--text-secondary)",
                }}
              >
                {DENSITY_LABELS[d]}
              </Button>
            ))}
          </div>
        </SettingRow>
      </SettingSection>

      <SettingSection title={t("font")} description={t("fontDescription")}>
        <SettingRow label={t("codeFont")}>
          <div className="flex gap-2">
            {(["sans", "mono"] as const).map((f) => (
              <Button
                key={f}
                variant="ghost"
                size="sm"
                onPress={() => handleCodeFont(f)}
                className="rounded-md border px-3 py-1.5 text-sm transition-all"
                style={{
                  fontFamily: f === "mono" ? "var(--font-mono)" : "var(--font-sans)",
                  borderColor: appearance.codeFont === f ? "var(--accent)" : "var(--border)",
                  backgroundColor:
                    appearance.codeFont === f ? "var(--accent-subtle)" : "transparent",
                  color: appearance.codeFont === f ? "var(--accent)" : "var(--text-secondary)",
                }}
              >
                {f === "sans" ? t("fontSans") : t("fontMono")}
              </Button>
            ))}
          </div>
        </SettingRow>
      </SettingSection>
    </div>
  );
}
