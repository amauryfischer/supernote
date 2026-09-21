"use client";

import { useEffect, useState } from "react";
import { Button, Input } from "@heroui/react";
import {
  EnvelopeSimple,
  Plug,
  Warning,
  CheckCircle,
  UsersThree,
  Trash,
  PencilSimple,
  ProhibitInset,
  SpeakerSlash,
} from "@phosphor-icons/react";
import { useSettings } from "../SettingsContext";
import { SettingRow } from "../SettingRow";
import { Textarea, useToast, Switch } from "@supernote/ui";
import { SettingSection } from "../SettingSection";
import { connectGmail, getGmailProfile, GMAIL_READONLY_SCOPE } from "@/lib/gmail";
import { clearAccessToken } from "@/lib/google-drive";
import { clearSummaryCache } from "@/lib/mail-summary";
import { loadImageSenders, untrustImageSender, MAIL_IMAGE_SENDERS_EVENT } from "@/lib/mail-html";
import { useGmailReconnect } from "@/components/mail/GmailReconnectBanner";
import { CONFIDENCE_LEVELS, DEFAULT_CONFIDENCE_LEVEL } from "@/lib/mail-autolabel";
import { NativeSelect } from "../NativeSelect";
import {
  loadBlockedSenders,
  loadMutedThreads,
  unblockSender,
  unmuteThread,
  MAIL_MUTE_EVENT,
} from "@/lib/mail-mute";

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
  const { toast } = useToast();
  const clientId = settings.googleDrive.clientId.trim();
  const gmail = settings.gmail;
  const aliases = gmail.aliases ?? [];
  const [busy, setBusy] = useState(false);
  // Filtres locaux (fils ignorés, expéditeurs bloqués) : rien ne doit être une
  // porte à sens unique — on les liste ici pour pouvoir les défaire.
  const [blocked, setBlocked] = useState<string[]>([]);
  const [mutedCount, setMutedCount] = useState(0);
  const [imageSenders, setImageSenders] = useState<string[]>([]);
  useEffect(() => {
    const refresh = () => {
      setBlocked([...loadBlockedSenders()]);
      setMutedCount(loadMutedThreads().size);
      setImageSenders([...loadImageSenders()]);
    };
    refresh();
    window.addEventListener(MAIL_MUTE_EVENT, refresh);
    window.addEventListener(MAIL_IMAGE_SENDERS_EVENT, refresh);
    return () => {
      window.removeEventListener(MAIL_MUTE_EVENT, refresh);
      window.removeEventListener(MAIL_IMAGE_SENDERS_EVENT, refresh);
    };
  }, []);
  const reconnect = useGmailReconnect(clientId);
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

        {isConnected && reconnect.required && (
          <SettingRow
            label="Reconnexion requise"
            description={reconnect.error ?? "Google a refusé le jeton : la boîte ne se synchronise plus."}
          >
            <Button variant="primary" size="sm" isDisabled={reconnect.busy} onPress={reconnect.reconnect}>
              <Plug size={14} />
              {reconnect.busy ? "Connexion…" : "Reconnecter"}
            </Button>
          </SettingRow>
        )}

        {isConnected && !reconnect.required && (
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
          title="Rédaction et lecture"
          description="Signature, densité de la liste, fenêtre d'annulation d'envoi et rappels de relance."
          icon={<PencilSimple size={16} />}
        >
          <SettingRow
            label="Signature"
            description="Ajoutée en bas des messages envoyés, après le séparateur « -- »."
          >
            <Textarea
              value={gmail.signature ?? ""}
              onChange={(e) => updateSettings("gmail", { ...gmail, signature: e.target.value })}
              onBlur={() => void saveSettings()}
              rows={4}
              placeholder={"Prénom Nom\nFonction · Société\n06 00 00 00 00"}
              className="w-full sm:w-96"
            />
          </SettingRow>

          <SettingRow
            label="Annuler l'envoi"
            description="Délai pendant lequel un message reste rattrapable avant de partir vraiment. 0 = envoi immédiat."
          >
            <div className="flex items-center gap-2">
              <Input
                type="number"
                min={0}
                max={60}
                value={String(gmail.undoSendSeconds ?? 8)}
                onChange={(e) => {
                  const n = Math.max(0, Math.min(60, Number(e.target.value) || 0));
                  updateSettings("gmail", { ...gmail, undoSendSeconds: n });
                }}
                onBlur={() => void saveSettings()}
                className="w-24"
                aria-label="Fenêtre d'annulation d'envoi, en secondes"
              />
              <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                secondes
              </span>
            </div>
          </SettingRow>

          <SettingRow
            label="Rappel de relance"
            description="Délai par défaut d'un rappel « pas de réponse » posé sur un fil."
          >
            <div className="flex items-center gap-2">
              <Input
                type="number"
                min={1}
                max={60}
                value={String(gmail.followupDays ?? 3)}
                onChange={(e) => {
                  const n = Math.max(1, Math.min(60, Number(e.target.value) || 1));
                  updateSettings("gmail", { ...gmail, followupDays: n });
                }}
                onBlur={() => void saveSettings()}
                className="w-24"
                aria-label="Délai par défaut d'un rappel de relance, en jours"
              />
              <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                jours
              </span>
            </div>
          </SettingRow>

          <SettingRow
            label="Classement automatique (IA locale)"
            description="Propose un tag pour chaque nouvel email (newsletter, notification, facture…) via Ollama. Rien ne sort de ta machine."
          >
            <Switch
              isSelected={gmail.autoLabel ?? false}
              onChange={(sel) => {
                updateSettings("gmail", { ...gmail, autoLabel: Boolean(sel) });
                void saveSettings();
              }}
              aria-label="Classement automatique des emails par l'IA locale"
            />
          </SettingRow>

          {(gmail.autoLabel ?? false) && (
            <SettingRow
              label="Exigence de confiance"
              description="Le même email est reclassé plusieurs fois : le tag n'est posé que si le modèle se répète. Cela mesure sa CONSTANCE, pas son exactitude — d'où « prudent » par défaut. Ce qui est écarté reste dans la boîte, sans tag."
            >
              <NativeSelect
                value={gmail.autoLabelConfidence ?? DEFAULT_CONFIDENCE_LEVEL}
                onChange={(v) => {
                  updateSettings("gmail", { ...gmail, autoLabelConfidence: v });
                  void saveSettings();
                }}
                options={CONFIDENCE_LEVELS.map((l) => ({ value: l.value, label: l.label }))}
              />
            </SettingRow>
          )}

          <SettingRow
            label="Mini-résumé dans la liste (IA locale)"
            description="Remplace l'aperçu Gmail par une phrase d'une trentaine de mots qui dit ce que l'email attend de toi. Généré une seule fois par fil, puis mis en cache sur cet appareil."
          >
            <div className="flex items-center gap-3">
              <Switch
                isSelected={gmail.listSummary ?? false}
                onChange={(sel) => {
                  updateSettings("gmail", { ...gmail, listSummary: Boolean(sel) });
                  void saveSettings();
                }}
                aria-label="Mini-résumé des emails dans la liste par l'IA locale"
              />
              {(gmail.listSummary ?? false) && (
                <Button
                  variant="ghost"
                  size="sm"
                  onPress={() => {
                    clearSummaryCache();
                    toast({
                      title: "Résumés effacés",
                      description: "Ils seront régénérés au prochain passage sur la boîte.",
                    });
                  }}
                >
                  Vider le cache
                </Button>
              )}
            </div>
          </SettingRow>
        </SettingSection>
      )}

      {isConnected && (blocked.length > 0 || mutedCount > 0 || imageSenders.length > 0) && (
        <SettingSection
          title="Filtres locaux"
          description="Gmail n'expose ni « ignorer un fil » ni filtre de blocage : Supernote applique ces règles lui-même, à chaque rafraîchissement de la boîte. Elles vivent sur cet appareil."
          icon={<ProhibitInset size={16} />}
        >
          {blocked.length > 0 && (
            <SettingRow
              label="Expéditeurs bloqués"
              description="Leurs nouveaux emails sont archivés dès leur arrivée."
            >
              <div className="flex w-full max-w-md flex-col gap-2">
                {blocked.map((addr) => (
                  <div
                    key={addr}
                    className="flex items-center justify-between gap-2 rounded-md px-3 py-1.5"
                    style={{ background: "var(--surface-2)" }}
                  >
                    <span className="truncate text-sm" style={{ color: "var(--text-primary)" }}>
                      {addr}
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={`Débloquer ${addr}`}
                      onPress={() => unblockSender(addr)}
                    >
                      Débloquer
                    </Button>
                  </div>
                ))}
              </div>
            </SettingRow>
          )}
          {mutedCount > 0 && (
            <SettingRow
              label="Fils ignorés"
              description="Ces fils sont ré-archivés s'ils remontent en boîte de réception."
            >
              <div className="flex items-center gap-2">
                <SpeakerSlash size={14} style={{ color: "var(--text-muted)" }} aria-hidden />
                <span className="text-sm" style={{ color: "var(--text-primary)" }}>
                  {mutedCount}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onPress={() => {
                    for (const id of loadMutedThreads()) unmuteThread(id);
                  }}
                >
                  Tout réactiver
                </Button>
              </div>
            </SettingRow>
          )}
          {imageSenders.length > 0 && (
            <SettingRow
              label="Images toujours affichées"
              description="Pour ces expéditeurs, les images distantes (et leurs pixels de suivi) se chargent sans demander."
            >
              <div className="flex w-full max-w-md flex-col gap-2">
                {imageSenders.map((addr) => (
                  <div
                    key={addr}
                    className="flex items-center justify-between gap-2 rounded-md px-3 py-1.5"
                    style={{ background: "var(--surface-2)" }}
                  >
                    <span className="truncate text-sm" style={{ color: "var(--text-primary)" }}>
                      {addr}
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={`Masquer à nouveau les images de ${addr}`}
                      onPress={() => untrustImageSender(addr)}
                    >
                      Retirer
                    </Button>
                  </div>
                ))}
              </div>
            </SettingRow>
          )}
        </SettingSection>
      )}

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
