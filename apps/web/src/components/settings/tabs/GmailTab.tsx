"use client";

import { useState } from "react";
import { Button, Input } from "@heroui/react";
import {
  EnvelopeSimple,
  Plug,
  Warning,
  CheckCircle,
  UsersThree,
  Trash,
} from "@phosphor-icons/react";
import { useSettings } from "../SettingsContext";
import { SettingRow } from "../SettingRow";
import { SettingSection } from "../SettingSection";
import { connectGmail, getGmailProfile, GMAIL_READONLY_SCOPE } from "@/lib/gmail";
import { clearAccessToken } from "@/lib/google-drive";

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/**
 * Onglet Gmail — connecte un compte Google pour lire ses emails dans l'app.
 * Réutilise le Client ID configuré dans l'onglet Google Drive ; demande le
 * scope `gmail.readonly` par consentement incrémental. Mode testing Google :
 * bandeau "app non vérifiée" + re-login ~7 jours (scope restricted).
 *
 * Gère aussi les « autres adresses à moi » (alias / boîtes partagées) : ces
 * adresses sont exclues du regroupement par expéditeur dans la liste mail (cf.
 * `buildMailOverlay`), au même titre que le compte connecté.
 */
export function GmailTab() {
  const { settings, updateSettings, saveSettings } = useSettings();
  const clientId = settings.googleDrive.clientId.trim();
  const gmail = settings.gmail;
  const aliases = gmail.aliases ?? [];
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

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

  // Validation d'ajout : email plausible, ≠ compte connecté, pas déjà listé
  // (insensible à la casse). On stocke en minuscule trim.
  const normalized = draft.trim().toLowerCase();
  const canAdd =
    EMAIL_RE.test(normalized) &&
    normalized !== gmail.connectedEmail.trim().toLowerCase() &&
    !aliases.some((a) => a.toLowerCase() === normalized);

  const addAlias = async () => {
    if (!canAdd) return;
    updateSettings("gmail", { ...gmail, aliases: [...aliases, normalized] });
    setDraft("");
    await saveSettings();
  };

  const removeAlias = async (email: string) => {
    updateSettings("gmail", { ...gmail, aliases: aliases.filter((a) => a !== email) });
    await saveSettings();
  };

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

      {isConnected && (
        <SettingSection
          title="Mes autres adresses"
          description="Alias et boîtes partagées (contact@…, etc.) traités comme ton compte : leurs emails ne forment jamais un groupe « expéditeur » dans la liste."
          icon={<UsersThree size={16} />}
        >
          {aliases.length > 0 && (
            <SettingRow label="Adresses">
              <div className="flex w-full max-w-md flex-col gap-2">
                {aliases.map((a) => (
                  <div
                    key={a}
                    className="flex items-center justify-between gap-2 rounded-md px-3 py-1.5"
                    style={{ background: "var(--surface-2)" }}
                  >
                    <span className="truncate text-sm" style={{ color: "var(--text-primary)" }}>
                      {a}
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={`Retirer ${a}`}
                      onPress={() => void removeAlias(a)}
                    >
                      <Trash size={14} />
                    </Button>
                  </div>
                ))}
              </div>
            </SettingRow>
          )}

          <SettingRow
            label="Ajouter"
            description="Saisis une adresse à toi (alias, boîte partagée) puis valide."
          >
            <div className="flex w-full max-w-md flex-col gap-2 sm:flex-row sm:items-center">
              <Input
                type="email"
                placeholder="contact@numerisk.fr"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void addAlias();
                  }
                }}
                className="w-full sm:w-72"
              />
              <Button
                variant="primary"
                size="sm"
                onPress={() => void addAlias()}
                isDisabled={!canAdd}
              >
                Ajouter
              </Button>
            </div>
          </SettingRow>
        </SettingSection>
      )}
    </div>
  );
}
