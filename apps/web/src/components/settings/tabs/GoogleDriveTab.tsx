"use client";

import { useState } from "react";
import { Button, Input } from "@heroui/react";
import { GoogleLogo, LinkSimple, Plug, Warning, CheckCircle } from "@phosphor-icons/react";
import { useSettings } from "../SettingsContext";
import { SettingRow } from "../SettingRow";
import { SettingSection } from "../SettingSection";
import {
  requestAccessToken,
  getUserEmail,
  clearAccessToken,
} from "@/lib/google-drive";

/**
 * Google Drive integration tab — lets the user wire up a Google Cloud
 * OAuth 2.0 client ID so the app can auto-resolve Drive-hosted
 * `.gdoc`/`.gsheet`/`.gslides` files that FSA can't read directly
 * (cloud placeholders). Settings persist via `SettingsContext`
 * (localStorage); tokens stay in-memory only.
 */
export function GoogleDriveTab() {
  const { settings, updateSettings, saveSettings } = useSettings();
  const { googleDrive } = settings;
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);

  const updateGoogleDrive = (patch: Partial<typeof googleDrive>) =>
    updateSettings("googleDrive", { ...googleDrive, ...patch });

  const handleConnect = async () => {
    if (!googleDrive.clientId.trim()) {
      setConnectError("Configure d'abord le Client ID.");
      return;
    }
    setConnecting(true);
    setConnectError(null);
    try {
      // Persist clientId first so a later page reload knows what to use.
      await saveSettings();
      // Force `consent` prompt on the initial connect so the user sees
      // exactly which scope is granted.
      await requestAccessToken(googleDrive.clientId.trim(), { prompt: "consent" });
      const email = await getUserEmail(googleDrive.clientId.trim());
      updateGoogleDrive({ connectedEmail: email });
      await saveSettings();
    } catch (err) {
      setConnectError(err instanceof Error ? err.message : String(err));
    } finally {
      setConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    clearAccessToken();
    updateGoogleDrive({ connectedEmail: "" });
    await saveSettings();
  };

  const isConnected = !!googleDrive.connectedEmail;

  return (
    <div className="space-y-6">
      <SettingSection
        title="Google Drive OAuth"
        description="Permet de résoudre automatiquement les .gdoc/.gsheet/.gslides quand le fichier local n'est qu'un placeholder cloud."
        icon={<GoogleLogo size={16} />}
      >
        <SettingRow
          label="Client ID OAuth"
          description="Créé dans Google Cloud Console (APIs & Services → Credentials → OAuth 2.0 Client IDs, type Web application)."
        >
          <Input
            type="text"
            placeholder="123456-abc.apps.googleusercontent.com"
            value={googleDrive.clientId}
            onChange={(e) => updateGoogleDrive({ clientId: e.target.value })}
            className="w-96"
          />
        </SettingRow>

        <SettingRow
          label="Origine JavaScript autorisée"
          description="À copier-coller dans la config OAuth Google (Authorized JavaScript origins)."
        >
          <code
            className="rounded px-2 py-1 text-xs"
            style={{ background: "var(--surface-2)", color: "var(--text-secondary)" }}
          >
            {typeof window !== "undefined" ? window.location.origin : "http://localhost:3101"}
          </code>
        </SettingRow>
      </SettingSection>

      <SettingSection
        title="Compte connecté"
        description="Token gardé en mémoire seulement (~1h). Re-connecter après chaque redémarrage de l'app."
        icon={<Plug size={16} />}
      >
        <SettingRow label="État">
          {isConnected ? (
            <div className="flex items-center gap-2">
              <CheckCircle size={14} style={{ color: "var(--success)" }} />
              <span className="text-sm" style={{ color: "var(--text-primary)" }}>
                {googleDrive.connectedEmail}
              </span>
            </div>
          ) : (
            <span className="text-sm" style={{ color: "var(--text-muted)" }}>
              Non connecté
            </span>
          )}
        </SettingRow>

        <SettingRow label="Action">
          <div className="flex items-center gap-2">
            {!isConnected ? (
              <Button
                variant="primary"
                size="sm"
                onPress={handleConnect}
                isDisabled={connecting || !googleDrive.clientId.trim()}
              >
                <LinkSimple size={14} />
                {connecting ? "Connexion…" : "Se connecter à Google"}
              </Button>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                onPress={handleDisconnect}
              >
                Se déconnecter
              </Button>
            )}
          </div>
        </SettingRow>

        {connectError && (
          <SettingRow label="">
            <div className="flex items-start gap-2 text-xs" style={{ color: "var(--color-danger, #ef4444)" }}>
              <Warning size={14} className="mt-0.5 shrink-0" />
              <span className="max-w-md break-words">{connectError}</span>
            </div>
          </SettingRow>
        )}
      </SettingSection>

      <SettingSection
        title="Comment ça marche"
        description="Une fois connecté, les fichiers Drive non disponibles localement seront résolus automatiquement."
      >
        <div
          className="rounded border p-3 text-xs leading-relaxed"
          style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}
        >
          <ol className="list-decimal pl-4">
            <li>Ouvre <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noopener noreferrer" style={{ color: "var(--accent)" }}>Google Cloud Console → Credentials</a>.</li>
            <li>Crée un OAuth 2.0 Client ID type <em>Web application</em>.</li>
            <li>Ajoute l&apos;origine ci-dessus dans <em>Authorized JavaScript origins</em>.</li>
            <li>Active <em>Drive API</em> dans <em>Library</em>.</li>
            <li>Copie le Client ID, colle ici, clique <em>Se connecter</em>.</li>
            <li>Tous tes .gdoc/.gsheet seront résolus automatiquement.</li>
          </ol>
        </div>
      </SettingSection>
    </div>
  );
}
