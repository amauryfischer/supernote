"use client";

import { useTheme } from "next-themes";
import { useSettings } from "../SettingsContext";
import { SettingRow } from "../SettingRow";
import { SettingSection } from "../SettingSection";
import { ACCENT_COLORS } from "../defaults";

type Theme = "light" | "dark" | "system";
type Density = "compact" | "normal" | "spacious";
type CodeFont = "sans" | "mono";

const THEME_LABELS: Record<Theme, string> = {
  light: "Clair",
  dark: "Sombre",
  system: "Système",
};

export function AppearanceTab() {
  const { theme, setTheme } = useTheme();
  const { settings, updateSettings } = useSettings();
  const { appearance } = settings;

  const handleAccent = (color: string) =>
    updateSettings("appearance", { ...appearance, accentColor: color });

  const handleDensity = (d: Density) =>
    updateSettings("appearance", { ...appearance, density: d });

  const handleCodeFont = (f: CodeFont) =>
    updateSettings("appearance", { ...appearance, codeFont: f });

  return (
    <div className="space-y-6">
      <SettingSection title="Thème" description="Apparence globale de l'interface">
        <SettingRow label="Mode d'affichage">
          <div className="flex gap-2">
            {(["light", "dark", "system"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTheme(t)}
                className="rounded-md border px-3 py-1.5 text-sm transition-all"
                style={{
                  borderColor: theme === t ? "var(--accent)" : "var(--border)",
                  backgroundColor: theme === t ? "var(--accent-subtle)" : "transparent",
                  color: theme === t ? "var(--accent)" : "var(--text-secondary)",
                  fontWeight: theme === t ? 500 : 400,
                }}
              >
                {THEME_LABELS[t]}
              </button>
            ))}
          </div>
        </SettingRow>
      </SettingSection>

      <SettingSection
        title="Couleur d'accentuation"
        description="Couleur principale de l'interface"
      >
        <SettingRow label="Palette">
          <div className="flex flex-wrap gap-2">
            {ACCENT_COLORS.map((color) => (
              <button
                key={color.value}
                title={color.label}
                onClick={() => handleAccent(color.value)}
                className="h-7 w-7 rounded-full transition-all"
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

      <SettingSection title="Densité" description="Espacement des éléments dans l'interface">
        <SettingRow label="Disposition">
          <div className="flex gap-2">
            {(["compact", "normal", "spacious"] as const).map((d) => (
              <button
                key={d}
                onClick={() => handleDensity(d)}
                className="rounded-md border px-3 py-1.5 text-sm transition-all"
                style={{
                  borderColor: appearance.density === d ? "var(--accent)" : "var(--border)",
                  backgroundColor:
                    appearance.density === d ? "var(--accent-subtle)" : "transparent",
                  color: appearance.density === d ? "var(--accent)" : "var(--text-secondary)",
                }}
              >
                {d === "compact" ? "Compact" : d === "normal" ? "Normal" : "Spacieux"}
              </button>
            ))}
          </div>
        </SettingRow>
      </SettingSection>

      <SettingSection title="Police" description="Fonte pour les blocs de code">
        <SettingRow label="Code font">
          <div className="flex gap-2">
            {(["sans", "mono"] as const).map((f) => (
              <button
                key={f}
                onClick={() => handleCodeFont(f)}
                className="rounded-md border px-3 py-1.5 text-sm transition-all"
                style={{
                  fontFamily: f === "mono" ? "var(--font-mono)" : "var(--font-sans)",
                  borderColor: appearance.codeFont === f ? "var(--accent)" : "var(--border)",
                  backgroundColor:
                    appearance.codeFont === f ? "var(--accent-subtle)" : "transparent",
                  color: appearance.codeFont === f ? "var(--accent)" : "var(--text-secondary)",
                }}
              >
                {f === "sans" ? "Sans-serif" : "Monospace"}
              </button>
            ))}
          </div>
        </SettingRow>
      </SettingSection>
    </div>
  );
}
