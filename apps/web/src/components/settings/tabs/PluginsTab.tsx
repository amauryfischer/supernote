"use client";

import { PuzzlePiece, Plus, Trash } from "@phosphor-icons/react";
import { useSettings } from "../SettingsContext";
import { SettingSection } from "../SettingSection";
import { ToggleSwitch } from "../ToggleSwitch";
import type { Plugin } from "../types";

function PluginCard({
  plugin,
  onToggle,
  onRemove,
}: {
  plugin: Plugin;
  onToggle: (enabled: boolean) => void;
  onRemove: () => void;
}) {
  return (
    <div
      className="flex items-center justify-between gap-4 rounded-lg border p-4"
      style={{ borderColor: "var(--border)", backgroundColor: "var(--surface-1)" }}
    >
      <div className="flex items-start gap-3">
        <div
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
          style={{ backgroundColor: "var(--accent-subtle)", color: "var(--accent)" }}
        >
          <PuzzlePiece size={14} />
        </div>
        <div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
              {plugin.name}
            </span>
            <span
              className="rounded-full px-1.5 py-0.5 text-[10px]"
              style={{ backgroundColor: "var(--surface-2)", color: "var(--text-muted)" }}
            >
              v{plugin.version}
            </span>
          </div>
          <p className="mt-0.5 text-xs" style={{ color: "var(--text-muted)" }}>
            {plugin.description}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <ToggleSwitch checked={plugin.enabled} onChange={onToggle} />
        <button
          onClick={onRemove}
          className="opacity-40 transition-opacity hover:opacity-100"
          style={{ color: "var(--danger)" }}
        >
          <Trash size={14} />
        </button>
      </div>
    </div>
  );
}

export function PluginsTab() {
  const { settings, updateSettings } = useSettings();
  const { plugins } = settings;

  const togglePlugin = (id: string, enabled: boolean) => {
    updateSettings(
      "plugins",
      plugins.map((p) => (p.id === id ? { ...p, enabled } : p)),
    );
  };

  const removePlugin = (id: string) => {
    updateSettings(
      "plugins",
      plugins.filter((p) => p.id !== id),
    );
  };

  return (
    <div className="space-y-6">
      <SettingSection
        title="Plugins installés"
        description="Gérez les extensions de Supernote"
        icon={<PuzzlePiece size={16} />}
        action={
          <button
            className="flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm transition-all hover:opacity-80"
            style={{ borderColor: "var(--border)", color: "var(--text-secondary)", backgroundColor: "var(--surface-1)" }}
          >
            <Plus size={14} />
            Installer un plugin
          </button>
        }
      >
        {plugins.length === 0 ? (
          <div
            className="rounded-lg border border-dashed py-12 text-center"
            style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}
          >
            <PuzzlePiece size={24} className="mx-auto mb-2 opacity-40" />
            <p className="text-sm">Aucun plugin installé</p>
            <p className="mt-1 text-xs">Installez des plugins pour étendre les fonctionnalités</p>
          </div>
        ) : (
          <div className="space-y-2">
            {plugins.map((plugin) => (
              <PluginCard
                key={plugin.id}
                plugin={plugin}
                onToggle={(enabled) => togglePlugin(plugin.id, enabled)}
                onRemove={() => removePlugin(plugin.id)}
              />
            ))}
          </div>
        )}
      </SettingSection>
    </div>
  );
}
