"use client";

import { GitBranch, ArrowsClockwise, CheckCircle, CloudCheck } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { Button, Input, Switch, Chip } from "@heroui/react";
import { useSettings } from "../SettingsContext";
import { SettingRow } from "../SettingRow";
import { SettingSection } from "../SettingSection";
import { RangeSlider } from "../RangeSlider";
import { useOnlineSync } from "@/lib/online-sync/OnlineSyncProvider";
import type { OnlineSyncStatus } from "@/lib/online-sync/client";

const STATUS_META: Record<
  OnlineSyncStatus,
  { label: string; color: "default" | "success" | "warning" | "danger" }
> = {
  disabled: { label: "Désactivé", color: "default" },
  connecting: { label: "Connexion…", color: "warning" },
  connected: { label: "Connecté — temps réel", color: "success" },
  offline: { label: "Hors ligne (reconnexion…)", color: "warning" },
  error: { label: "Indisponible", color: "danger" },
};

function OnlineSyncSection() {
  const online = useOnlineSync();
  const [serverUrl, setServerUrl] = useState("");
  const [vaultKey, setVaultKey] = useState("");
  const [token, setToken] = useState("");

  // Seed the form from the persisted config once it's available.
  useEffect(() => {
    if (!online) return;
    setServerUrl(online.config.serverUrl);
    setVaultKey(online.config.vaultKey);
    setToken(online.config.token);
  }, [online?.config.serverUrl, online?.config.vaultKey, online?.config.token]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!online) {
    return (
      <SettingSection
        title="Synchronisation en ligne"
        description="Disponible une fois un coffre ouvert."
        icon={<CloudCheck size={16} />}
      >
        <p className="text-xs" style={{ color: "var(--text-muted)" }}>
          Ouvrez un coffre pour configurer la synchronisation temps réel.
        </p>
      </SettingSection>
    );
  }

  const { status, config, lastError } = online;
  const meta = STATUS_META[status];
  const enabled = config.enabled;

  const handleConnect = () => {
    if (!vaultKey.trim()) return;
    online.enable({
      serverUrl: serverUrl.trim(),
      vaultKey: vaultKey.trim(),
      token: token.trim(),
    });
  };

  return (
    <SettingSection
      title="Synchronisation en ligne (temps réel)"
      description="Synchronise le coffre entre vos appareils (web et Android) dès qu'un serveur avec base de données est disponible. Fonctionne aussi par-dessus un coffre dossier (ex. Google Drive) : la note reste un fichier .md local ET se réplique en direct."
      icon={<CloudCheck size={16} />}
      action={
        <Chip size="sm" variant="soft" color={meta.color}>
          {meta.label}
        </Chip>
      }
    >
      <SettingRow
        label="Activer"
        description="Réplique chaque note via le serveur, en direct."
      >
        <Switch
          isSelected={enabled}
          onChange={(selected: boolean) => {
            if (selected) handleConnect();
            else online.disable();
          }}
          aria-label="Activer la synchronisation en ligne"
        />
      </SettingRow>

      <SettingRow
        label="Serveur"
        description="Laisser vide = même serveur que l'application."
      >
        <Input
          type="url"
          placeholder="Même origine (par défaut)"
          value={serverUrl}
          onChange={(e) => setServerUrl(e.target.value)}
          className="w-72"
        />
      </SettingRow>

      <SettingRow
        label="Clé de salon"
        description="Même clé sur tous vos appareils pour les apparier."
      >
        <Input
          type="text"
          placeholder="mon-coffre-perso"
          value={vaultKey}
          onChange={(e) => setVaultKey(e.target.value)}
          className="w-72"
        />
      </SettingRow>

      <SettingRow label="Jeton (optionnel)" description="Si le serveur exige un secret partagé.">
        <Input
          type="password"
          placeholder="••••••••"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          className="w-72"
        />
      </SettingRow>

      <SettingRow label="Connexion">
        <Button
          variant="ghost"
          size="sm"
          onPress={handleConnect}
          isDisabled={!vaultKey.trim()}
          className="flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm"
          style={{
            borderColor: "var(--accent)",
            color: "var(--accent)",
            backgroundColor: "var(--accent-subtle)",
          }}
        >
          <ArrowsClockwise size={14} />
          {enabled ? "Reconnecter" : "Connecter"}
        </Button>
      </SettingRow>

      {lastError && status === "error" && (
        <p className="mt-2 text-xs" style={{ color: "var(--danger)" }}>
          {lastError}
        </p>
      )}
    </SettingSection>
  );
}

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
      <OnlineSyncSection />

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
