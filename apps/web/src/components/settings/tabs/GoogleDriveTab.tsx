"use client";

import { useState } from "react";
import { Button, Input } from "@heroui/react";
import { GoogleLogo, LinkSimple, Plug, Warning, CheckCircle, MagnifyingGlass } from "@phosphor-icons/react";
import { useSettings } from "../SettingsContext";
import { SettingRow } from "../SettingRow";
import { SettingSection } from "../SettingSection";
import { useVault } from "@/lib/pwa/PwaVaultSetup";
import {
  requestAccessToken,
  getUserEmail,
  clearAccessToken,
  searchFiles,
  type DriveFile,
} from "@/lib/google-drive";

const DRIVE_FOLDER_MIME = "application/vnd.google-apps.folder";

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
  const vault = useVault();
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [detecting, setDetecting] = useState(false);
  const [detectMsg, setDetectMsg] = useState<string | null>(null);
  const [detectMatches, setDetectMatches] = useState<DriveFile[]>([]);

  const updateGoogleDrive = (patch: Partial<typeof googleDrive>) =>
    updateSettings("googleDrive", { ...googleDrive, ...patch });

  const pickDetected = async (folder: DriveFile) => {
    updateGoogleDrive({ driveRootFolderId: folder.id });
    setDetectMatches([]);
    setDetectMsg(`Dossier « ${folder.name} » lié (${folder.id}).`);
    await saveSettings();
  };

  /**
   * Auto-détecte l'ID du dossier Drive correspondant à la racine du vault en
   * cherchant un dossier Drive du même NOM (le seul indice exploitable : FSA
   * n'expose pas le chemin absolu local). 1 résultat → on remplit ; plusieurs
   * → l'utilisateur choisit ; 0 → saisie manuelle.
   */
  const handleDetect = async () => {
    const name = vault?.vaultName?.trim();
    setDetectMsg(null);
    setDetectMatches([]);
    if (!googleDrive.clientId.trim()) {
      setDetectMsg("Connecte d'abord Google Drive.");
      return;
    }
    if (!name || name === "Coffre cloud") {
      setDetectMsg("Vault sans nom de dossier exploitable (coffre cloud). Saisie manuelle.");
      return;
    }
    setDetecting(true);
    try {
      const folders = await searchFiles(googleDrive.clientId.trim(), name, DRIVE_FOLDER_MIME);
      if (folders.length === 0) {
        setDetectMsg(`Aucun dossier Drive nommé « ${name} ». Vérifie le nom ou saisis l'ID.`);
      } else if (folders.length === 1) {
        await pickDetected(folders[0]!);
      } else {
        setDetectMatches(folders);
        setDetectMsg(`${folders.length} dossiers nommés « ${name} » — choisis le bon :`);
      }
    } catch (err) {
      setDetectMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setDetecting(false);
    }
  };

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

        {isConnected && (
          <SettingRow
            label="Dossier Drive du vault"
            description="ID du dossier Drive = racine de ce vault. Les nouveaux Google Docs/Sheets/Slides y sont créés (sous-dossiers résolus par nom), puis Google Drive Desktop redescend le fichier dans le bon dossier. Vide = racine My Drive. « Détecter » cherche un dossier Drive du même nom que le vault."
          >
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <Input
                  type="text"
                  placeholder="1AbCdEf… (ID du dossier racine)"
                  value={googleDrive.driveRootFolderId}
                  onChange={(e) => updateGoogleDrive({ driveRootFolderId: e.target.value.trim() })}
                  onBlur={() => void saveSettings()}
                  className="w-96"
                />
                <Button
                  variant="outline"
                  size="sm"
                  onPress={handleDetect}
                  isDisabled={detecting}
                >
                  <MagnifyingGlass size={14} />
                  {detecting ? "Recherche…" : "Détecter"}
                </Button>
              </div>

              {detectMsg && (
                <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                  {detectMsg}
                </span>
              )}

              {detectMatches.length > 1 && (
                <div className="flex max-w-md flex-col gap-1">
                  {detectMatches.map((f) => (
                    <Button
                      key={f.id}
                      variant="ghost"
                      size="sm"
                      onPress={() => void pickDetected(f)}
                      className="justify-start"
                    >
                      <span className="truncate">{f.name}</span>
                      <span className="ml-auto text-[10px]" style={{ color: "var(--text-muted)" }}>
                        {f.id.slice(0, 14)}…
                      </span>
                    </Button>
                  ))}
                </div>
              )}
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
