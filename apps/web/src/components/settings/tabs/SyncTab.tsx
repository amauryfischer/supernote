"use client";

import { GitBranch, ArrowsClockwise, CheckCircle, CloudCheck, Plugs } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { Switch } from "@supernote/ui";
import { Button, Input, Chip } from "@heroui/react";
import { useSettings } from "../SettingsContext";
import { SettingRow } from "../SettingRow";
import { SettingSection } from "../SettingSection";
import { RangeSlider } from "../RangeSlider";
import { useOnlineSync } from "@/lib/online-sync/OnlineSyncProvider";
import { changeVaultPassword, joinVault, type OnlineSyncStatus } from "@/lib/online-sync/client";
import { normalizeVaultKey } from "@/lib/online-sync/config-storage";
import { trpc } from "@/lib/trpc/client";
import { ConnectVaultModal } from "@/components/notes/ConnectVaultModal";

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
  const [joinError, setJoinError] = useState<string | null>(null);
  const [nextPassword, setNextPassword] = useState("");
  const [passwordNotice, setPasswordNotice] = useState<{ ok: boolean; text: string } | null>(null);

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

  // Un mot de passe saisi protège le salon s'il est libre : c'est le chemin de
  // migration des salons existants et de reconnexion d'un appareil verrouillé.
  const handleConnect = async () => {
    if (!vaultKey.trim()) return;
    setJoinError(null);
    if (token.trim()) {
      const error = await joinVault(serverUrl.trim(), normalizeVaultKey(vaultKey), token.trim());
      if (error) {
        setJoinError(error);
        return;
      }
    }
    online.enable({
      serverUrl: serverUrl.trim(),
      vaultKey: vaultKey.trim(),
      token: token.trim(),
    });
  };

  const handleChangePassword = async () => {
    setPasswordNotice(null);
    const error = await changeVaultPassword(
      config.serverUrl,
      normalizeVaultKey(config.vaultKey),
      config.token,
      nextPassword,
    );
    if (error) {
      setPasswordNotice({ ok: false, text: error });
      return;
    }
    online.enable({ serverUrl: config.serverUrl, vaultKey: config.vaultKey, token: nextPassword });
    setNextPassword("");
    setPasswordNotice({
      ok: true,
      text: "Mot de passe changé. Vos autres appareils le redemanderont dans Réglages › Synchronisation.",
    });
  };

  return (
    <SettingSection
      title="Synchronisation en ligne (temps réel)"
      description="Alternative à Git : synchronise le coffre entre vos appareils (web et Android) dès qu'un serveur avec base de données est disponible."
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
            if (selected) void handleConnect();
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
        label="Nom du salon"
        description="Même nom sur tous vos appareils pour les apparier."
      >
        <Input
          type="text"
          placeholder="mon-coffre-perso"
          value={vaultKey}
          onChange={(e) => setVaultKey(e.target.value)}
          className="w-72"
        />
      </SettingRow>

      <SettingRow
        label="Mot de passe du salon"
        description="Protège un salon libre et l'affiche à l'écran d'accueil de vos autres appareils. 8 caractères minimum."
      >
        <Input
          type="password"
          placeholder="••••••••"
          value={token}
          onChange={(e) => {
            setToken(e.target.value);
            setJoinError(null);
          }}
          className="w-72"
        />
      </SettingRow>

      <SettingRow label="Connexion">
        <Button
          variant="ghost"
          size="sm"
          onPress={() => void handleConnect()}
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

      {enabled && config.token && (
        <SettingRow
          label="Changer le mot de passe"
          description="Les autres appareils du salon devront saisir le nouveau. 8 caractères minimum."
        >
          <div className="flex max-w-full flex-wrap items-center gap-2">
            <Input
              type="password"
              aria-label="Nouveau mot de passe du salon"
              placeholder="Nouveau mot de passe"
              value={nextPassword}
              onChange={(e) => {
                setNextPassword(e.target.value);
                setPasswordNotice(null);
              }}
              className="w-72 max-w-full"
            />
            <Button
              variant="ghost"
              size="sm"
              onPress={() => void handleChangePassword()}
              isDisabled={nextPassword.length < 8}
              className="rounded-md border px-3 py-1.5 text-sm"
              style={{ borderColor: "var(--border)" }}
            >
              Changer
            </Button>
          </div>
        </SettingRow>
      )}

      {passwordNotice && (
        <p className="mt-2 text-xs" style={{ color: passwordNotice.ok ? "var(--success)" : "var(--danger)" }}>
          {passwordNotice.text}
        </p>
      )}

      {joinError && (
        <p className="mt-2 text-xs" style={{ color: "var(--danger)" }}>
          {joinError}
        </p>
      )}

      {lastError && status === "error" && (
        <p className="mt-2 text-xs" style={{ color: "var(--danger)" }}>
          {lastError}
        </p>
      )}
    </SettingSection>
  );
}

/**
 * Vaults connectés — liste les montages cloud (`vault_mount`) déclarés dans le
 * coffre père et offre l'entrée « Connecter un vault » (même modale que le
 * FileTree desktop et le tiroir « Plus » mobile). La déconnexion par ligne est
 * traitée dans une tâche ultérieure.
 */
function MountsSection() {
  const [connectVaultOpen, setConnectVaultOpen] = useState(false);
  const mountsQuery = trpc.sync.listMounts.useQuery({ sourceVaultId: null });
  const mounts = mountsQuery.data?.mounts ?? [];

  return (
    <SettingSection
      title="Vaults connectés"
      description="Salons cloud montés dans ce coffre. Leurs notes apparaissent aux côtés des vôtres."
      icon={<Plugs size={16} />}
      action={
        <Button
          variant="ghost"
          size="sm"
          onPress={() => setConnectVaultOpen(true)}
          className="flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm"
          style={{
            borderColor: "var(--accent)",
            color: "var(--accent)",
            backgroundColor: "var(--accent-subtle)",
          }}
        >
          <Plugs size={14} />
          Connecter un vault
        </Button>
      }
    >
      {mounts.length === 0 ? (
        <p className="py-3 text-xs" style={{ color: "var(--text-muted)" }}>
          {mountsQuery.isLoading
            ? "Chargement des vaults connectés…"
            : "Aucun vault connecté pour l'instant."}
        </p>
      ) : (
        mounts.map((mount, idx) => (
          <SettingRow
            key={`${mount.vaultKey}-${idx}`}
            label={mount.label || mount.vaultKey}
            description={mount.serverUrl || undefined}
          >
            <Chip size="sm" variant="soft" color="success">
              Connecté
            </Chip>
          </SettingRow>
        ))
      )}

      <ConnectVaultModal isOpen={connectVaultOpen} onOpenChange={setConnectVaultOpen} />
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

      <MountsSection />

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
