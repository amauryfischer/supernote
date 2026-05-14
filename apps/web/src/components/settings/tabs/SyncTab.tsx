"use client";

import { GitBranch, ArrowsClockwise, CheckCircle } from "@phosphor-icons/react";
import { useState } from "react";
import { Button, Input } from "@heroui/react";
import { useSettings } from "../SettingsContext";
import { SettingRow } from "../SettingRow";
import { SettingSection } from "../SettingSection";
import { RangeSlider } from "../RangeSlider";

export function SyncTab() {
  const { settings, updateSettings } = useSettings();
  const { sync } = settings;
  const [syncing, setSyncing] = useState(false);
  const lastSync = "Il y a 3 minutes";

  const updateSync = (patch: Partial<typeof sync>) =>
    updateSettings("sync", { ...sync, ...patch });

  const handleSyncNow = async () => {
    setSyncing(true);
    await new Promise((r) => setTimeout(r, 1500));
    setSyncing(false);
  };

  return (
    <div className="space-y-6">
      <SettingSection
        title="Git Remote"
        description="Synchronisation avec un dépôt git distant"
        icon={<GitBranch size={16} />}
      >
        <SettingRow label="URL remote">
          <Input
            type="url"
            placeholder="https://github.com/user/vault.git"
            value={sync.gitRemoteUrl}
            onChange={(e) => updateSync({ gitRemoteUrl: e.target.value })}
            className="w-72"
          />
        </SettingRow>

        <SettingRow
          label="Auto-commit"
          description={`Toutes les ${sync.autoCommitInterval} min`}
        >
          <RangeSlider
            min={1}
            max={60}
            step={1}
            value={sync.autoCommitInterval}
            onChange={(v) => updateSync({ autoCommitInterval: v })}
          />
        </SettingRow>
      </SettingSection>

      <SettingSection title="Actions" description="Synchronisation manuelle et état">
        <SettingRow label="Synchroniser">
          <Button
            variant="ghost"
            size="sm"
            onPress={handleSyncNow}
            isDisabled={syncing}
            className="flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm"
            style={{
              borderColor: "var(--accent)",
              color: "var(--accent)",
              backgroundColor: "var(--accent-subtle)",
            }}
          >
            <ArrowsClockwise size={14} className={syncing ? "animate-spin" : ""} />
            Sync now
          </Button>
        </SettingRow>

        <SettingRow label="Dernier sync">
          <div className="flex items-center gap-2">
            <CheckCircle size={14} style={{ color: "var(--success)" }} />
            <span className="text-sm" style={{ color: "var(--text-secondary)" }}>
              {lastSync}
            </span>
          </div>
        </SettingRow>

        <SettingRow label="État">
          <div className="flex items-center gap-2">
            <span
              className="rounded-full px-2 py-0.5 text-xs font-medium"
              style={{ backgroundColor: "color-mix(in srgb, var(--success) 15%, transparent)", color: "var(--success)" }}
            >
              2 commits ahead
            </span>
            <span
              className="rounded-full px-2 py-0.5 text-xs font-medium"
              style={{ backgroundColor: "var(--surface-2)", color: "var(--text-muted)" }}
            >
              0 behind
            </span>
          </div>
        </SettingRow>
      </SettingSection>
    </div>
  );
}
