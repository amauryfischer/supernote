"use client";

import { useState } from "react";
import { Button } from "@heroui/react";
import { EnvelopeSimple, Plug, Warning, CheckCircle } from "@phosphor-icons/react";
import { useSettings } from "../SettingsContext";
import { SettingRow } from "../SettingRow";
import { SettingSection } from "../SettingSection";
import { connectGmail, getGmailProfile, GMAIL_READONLY_SCOPE } from "@/lib/gmail";
import { clearAccessToken } from "@/lib/google-drive";

/**
 * Onglet Gmail — connecte un compte Google pour lire ses emails dans l'app.
 * Réutilise le Client ID configuré dans l'onglet Google Drive ; demande le
 * scope `gmail.readonly` par consentement incrémental. Mode testing Google :
 * bandeau "app non vérifiée" + re-login ~7 jours (scope restricted).
 */
export function GmailTab() {
  const { settings, updateSettings, saveSettings } = useSettings();
  const clientId = settings.googleDrive.clientId.trim();
  const gmail = settings.gmail;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleConnect = async () => {
    if (!clientId) {
      setError("Configure d'abord le Client ID dans l'onglet Google Drive.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await connectGmail(clientId);
      const email = await getGmailProfile(clientId);
      updateSettings("gmail", { ...gmail, connectedEmail: email });
      await saveSettings();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleDisconnect = async () => {
    clearAccessToken({ clientId, scope: GMAIL_READONLY_SCOPE });
    updateSettings("gmail", { ...gmail, connectedEmail: "" });
    await saveSettings();
  };

  const isConnected = !!gmail.connectedEmail;

  return (
    <div className="space-y-6">
      <SettingSection
        title="Gmail"
        description="Lis et recherche tes emails depuis l'app. Réutilise le compte Google configuré dans l'onglet Google Drive ; nécessite que l'API Gmail soit activée dans le même projet Google Cloud et le compte ajouté aux « test users »."
        icon={<EnvelopeSimple size={16} />}
      >
        <SettingRow
          label="Compte Gmail"
          description={
            isConnected
              ? `Connecté : ${gmail.connectedEmail}`
              : "Aucun compte connecté. Scope demandé : gmail.readonly (lecture seule)."
          }
        >
          {isConnected ? (
            <Button
              variant="ghost"
              size="sm"
              onPress={() => void handleDisconnect()}
            >
              <Plug size={14} />
              Déconnecter
            </Button>
          ) : (
            <Button
              variant="primary"
              size="sm"
              onPress={() => void handleConnect()}
              isDisabled={busy}
            >
              <Plug size={14} />
              {busy ? "Connexion…" : "Connecter Gmail"}
            </Button>
          )}
        </SettingRow>

        {error && (
          <SettingRow label="">
            <div className="flex items-start gap-2 text-xs" style={{ color: "var(--color-danger, #ef4444)" }}>
              <Warning size={14} className="mt-0.5 shrink-0" />
              <span className="max-w-md break-words">{error}</span>
            </div>
          </SettingRow>
        )}

        {isConnected && (
          <SettingRow label="">
            <div className="flex items-center gap-2 text-xs" style={{ color: "var(--success)" }}>
              <CheckCircle size={14} />
              Gmail connecté. Token en lecture seule, ré-auth ~hebdomadaire (mode testing).
            </div>
          </SettingRow>
        )}
      </SettingSection>
    </div>
  );
}
