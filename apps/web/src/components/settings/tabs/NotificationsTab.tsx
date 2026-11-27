"use client";

import { useCallback, useEffect, useState } from "react";
import { Bell, DeviceMobile, Devices, GearSix, Trash } from "@phosphor-icons/react";
import { Button, Input, Switch, Tooltip } from "@supernote/ui";
import { useSettings } from "../SettingsContext";
import { SettingRow } from "../SettingRow";
import { SettingSection } from "../SettingSection";
import { ToggleSwitch } from "../ToggleSwitch";
import { NativeSelect } from "../NativeSelect";
import { useOnlineSync } from "@/lib/online-sync/OnlineSyncProvider";
import { useActionFeedback, FeedbackIcon } from "@/lib/action-feedback";
import { formatAgo } from "@/lib/dateFormat";
import { grantMailAccess, mailGrantEmail } from "@/lib/mail-push-watch";
import {
  fetchPushConfig,
  listPushDevices,
  loadDevicePrefs,
  pushAvailability,
  removePushDevice,
  sendPushPrefs,
  sendTestPush,
  subscribePush,
  unsubscribePush,
  type PushAvailability,
  type PushDevice,
  type PushDevicePrefs,
} from "@/lib/push/push-client";

const PUSH_HINTS: Record<PushAvailability, string> = {
  ok: "Rappels, événements et relances, même Supernote fermé, sur tous les appareils du salon.",
  "ios-not-installed": "Ajoute Supernote à l'écran d'accueil pour recevoir les notifications.",
  unsupported: "Ce navigateur ne reçoit pas les notifications push.",
  "no-sync": "Active la synchronisation en ligne pour recevoir les notifications.",
  "no-password": "Protège ton salon par un mot de passe pour activer les notifications.",
};

function PushRow({ onOpenSync }: { onOpenSync: () => void }) {
  const { settings, updateSettings } = useSettings();
  const online = useOnlineSync();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const subscribed = settings.notifications.pushSubscribed;
  const availability = online ? pushAvailability(online.config) : "no-sync";

  const toggle = async (next: boolean) => {
    setPending(true);
    setError(null);
    try {
      await (next ? subscribePush(online?.config) : unsubscribePush(online?.config));
      updateSettings("notifications", { ...settings.notifications, pushSubscribed: next });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(false);
    }
  };

  return (
    <>
      <SettingRow label="Notifications app fermée" description={PUSH_HINTS[availability]}>
        <div className="flex items-center gap-2">
          {(availability === "no-sync" || availability === "no-password") && (
            <Tooltip content="Configurer le salon">
              <Button variant="ghost" size="icon" aria-label="Configurer le salon" onPress={onOpenSync}>
                <GearSix size={16} />
              </Button>
            </Tooltip>
          )}
          <Switch
            aria-label="Notifications app fermée"
            className="sn-hit"
            isSelected={subscribed}
            isDisabled={pending || (availability !== "ok" && !subscribed)}
            onChange={(next) => void toggle(next)}
          />
        </div>
      </SettingRow>
      {error && (
        <p role="alert" className="py-2 text-xs" style={{ color: "var(--danger)" }}>
          {error}
        </p>
      )}
    </>
  );
}

function MailGrantRow() {
  const { settings } = useSettings();
  const online = useOnlineSync();
  const [serverReady, setServerReady] = useState(false);
  const [email, setEmail] = useState(mailGrantEmail);
  const fb = useActionFeedback();
  const clientId = settings.googleDrive.clientId.trim();
  const eligible =
    settings.notifications.pushSubscribed && Boolean(clientId) && online !== null && pushAvailability(online.config) === "ok";

  useEffect(() => {
    if (!eligible) return;
    let alive = true;
    void fetchPushConfig()
      .then((c) => alive && setServerReady(c.mailGrant))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [eligible]);

  if (!eligible || !serverReady) return null;

  const grant = () => void fb.run(async () => setEmail(await grantMailAccess(clientId, online?.config)));

  return (
    <>
      <SettingRow
        label="Mails détaillés app fermée"
        description={
          email
            ? `Actif pour ${email} : expéditeur et objet affichés même Supernote fermé.`
            : "Affiche l'expéditeur et l'objet même quand Supernote est fermé depuis plus d'une heure."
        }
      >
        <Button size="sm" variant={email ? "ghost" : undefined} isDisabled={fb.isPending} onPress={grant}>
          <FeedbackIcon state={fb.state} error={fb.error} size={14} idle={null} />
          {email ? "Réautoriser" : "Autoriser"}
        </Button>
      </SettingRow>
      {fb.error && (
        <p role="alert" className="py-2 text-xs" style={{ color: "var(--danger)" }}>
          {fb.error}
        </p>
      )}
    </>
  );
}

const MAIL_MODES = [
  { value: "people", label: "Personnes seulement", hint: "Pas de vibration pour les mails automatiques ni pour tes notes à toi-même." },
  { value: "all", label: "Tous", hint: "Chaque nouveau mail, sauf ceux que tu t'envoies." },
  { value: "off", label: "Aucun", hint: "Aucune notification de mail sur cet appareil." },
] as const;

const CATEGORY_ROWS: { key: "reminder" | "event" | "habit" | "followup"; label: string; description: string }[] = [
  { key: "reminder", label: "Rappels de tâches", description: "À l'heure du rappel, avec « Fait » et « Dans 1 h »." },
  { key: "event", label: "Agenda", description: "15 min avant chaque événement, avec « Rejoindre » s'il y a une visio." },
  { key: "habit", label: "Habitudes", description: "Les rappels réglés sur chaque habitude." },
  { key: "followup", label: "Relances et reports", description: "Mails restés sans réponse, fils reportés qui reviennent." },
];

function DevicePrefsSection() {
  const [prefs, setPrefs] = useState<PushDevicePrefs>(loadDevicePrefs);
  const [error, setError] = useState<string | null>(null);
  const mode = MAIL_MODES.find((m) => m.value === prefs.mail) ?? MAIL_MODES[0];

  const save = (next: PushDevicePrefs) => {
    setPrefs(next);
    setError(null);
    void sendPushPrefs(next).catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  };
  const setQuietTime = (edge: "start" | "end", value: string) => {
    if (value) save({ ...prefs, quiet: { ...prefs.quiet, [edge]: value } });
  };

  return (
    <SettingSection
      title="Sur cet appareil"
      description="Ce que cet appareil reçoit quand Supernote est fermé. Chaque appareil a ses propres réglages."
      icon={<DeviceMobile size={16} />}
    >
      <SettingRow label="Mails" description={mode.hint}>
        <NativeSelect
          value={mode.value}
          onChange={(v) => {
            const next = MAIL_MODES.find((m) => m.value === v);
            if (next) save({ ...prefs, mail: next.value });
          }}
          options={MAIL_MODES.map(({ value, label }) => ({ value, label }))}
        />
      </SettingRow>
      {CATEGORY_ROWS.map(({ key, label, description }) => (
        <SettingRow key={key} label={label} description={description}>
          <Switch aria-label={label} className="sn-hit" isSelected={prefs[key]} onChange={(on) => save({ ...prefs, [key]: on })} />
        </SettingRow>
      ))}
      <SettingRow
        label="Heures calmes"
        description="Rien ne sonne ni ne vibre : les notifications arrivent en silence dans le volet."
      >
        <div className="flex flex-wrap items-center gap-2">
          {prefs.quiet.on && (
            <>
              <Input
                id="push-quiet-start"
                aria-label="Début des heures calmes"
                type="time"
                step={900}
                value={prefs.quiet.start}
                onChange={(e) => setQuietTime("start", e.target.value)}
                className="w-[7rem]"
              />
              <span aria-hidden="true" style={{ color: "var(--text-muted)" }}>→</span>
              <Input
                id="push-quiet-end"
                aria-label="Fin des heures calmes"
                type="time"
                step={900}
                value={prefs.quiet.end}
                onChange={(e) => setQuietTime("end", e.target.value)}
                className="w-[7rem]"
              />
            </>
          )}
          <Switch
            aria-label="Heures calmes"
            className="sn-hit"
            isSelected={prefs.quiet.on}
            onChange={(on) => save({ ...prefs, quiet: { ...prefs.quiet, on } })}
          />
        </div>
      </SettingRow>
      {error && (
        <p role="alert" className="py-2 text-xs" style={{ color: "var(--danger)" }}>
          {error}
        </p>
      )}
    </SettingSection>
  );
}

function DeviceRow({ device, onChanged }: { device: PushDevice; onChanged: () => void }) {
  const fb = useActionFeedback();
  const delivered = device.lastOkAt ? `Dernière livraison ${formatAgo(device.lastOkAt)}` : "Aucune livraison confirmée";

  return (
    <SettingRow label={device.mine ? `${device.label} · cet appareil` : device.label} description={delivered}>
      {device.mine ? (
        <Button
          size="sm"
          variant="outline"
          className="flex items-center gap-1.5"
          isDisabled={fb.isPending}
          onPress={() => void fb.run(async () => {
            await sendTestPush();
            onChanged();
          })}
        >
          <FeedbackIcon state={fb.state} error={fb.error} size={14} idle={null} />
          Tester
        </Button>
      ) : (
        <Tooltip content="Retirer cet appareil (il se réabonne à sa prochaine ouverture)">
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Retirer ${device.label}`}
            isDisabled={fb.isPending}
            onPress={() => void fb.run(async () => {
              await removePushDevice(device.endpoint);
              onChanged();
            })}
          >
            {fb.state === "idle" ? <Trash size={16} /> : <FeedbackIcon state={fb.state} error={fb.error} size={16} idle={null} />}
          </Button>
        </Tooltip>
      )}
    </SettingRow>
  );
}

function DevicesSection() {
  const online = useOnlineSync();
  const vaultKey = online?.config.vaultKey ?? "";
  const [devices, setDevices] = useState<PushDevice[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    if (!vaultKey) return;
    void listPushDevices()
      .then((list) => {
        setDevices(list);
        setError(null);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, [vaultKey]);
  useEffect(reload, [reload]);

  return (
    <SettingSection
      title="Appareils"
      description="Les appareils de ce salon qui reçoivent les notifications. « Tester » envoie un vrai push par le serveur."
      icon={<Devices size={16} />}
    >
      {devices?.map((device) => <DeviceRow key={device.endpoint} device={device} onChanged={reload} />)}
      {devices?.length === 0 && (
        <p className="py-3 text-xs" style={{ color: "var(--text-muted)" }}>
          Aucun appareil abonné.
        </p>
      )}
      {error && (
        <p role="alert" className="py-2 text-xs" style={{ color: "var(--danger)" }}>
          {error}
        </p>
      )}
    </SettingSection>
  );
}

export function NotificationsTab({ onOpenSync }: { onOpenSync: () => void }) {
  const { settings, updateSettings } = useSettings();
  const { notifications } = settings;
  const online = useOnlineSync();
  const pushReady = notifications.pushSubscribed && online !== null && pushAvailability(online.config) === "ok";

  const update = (patch: Partial<typeof notifications>) =>
    updateSettings("notifications", { ...notifications, ...patch });

  return (
    <div className="space-y-6">
      <SettingSection
        title="Notifications"
        description="Configurez les alertes et messages de l'application"
        icon={<Bell size={16} />}
      >
        <SettingRow
          label="Notifications quand Supernote est ouvert"
          description="Alertes système des routines pendant que l'app tourne"
        >
          <ToggleSwitch
            checked={notifications.osNotifications}
            onChange={(v) => update({ osNotifications: v })}
          />
        </SettingRow>

        <PushRow onOpenSync={onOpenSync} />
        <MailGrantRow />

        <SettingRow label="Sons" description="Jouer un son pour les notifications importantes">
          <ToggleSwitch
            checked={notifications.sounds}
            onChange={(v) => update({ sounds: v })}
          />
        </SettingRow>
      </SettingSection>

      {pushReady && <DevicePrefsSection />}
      {pushReady && <DevicesSection />}
    </div>
  );
}
