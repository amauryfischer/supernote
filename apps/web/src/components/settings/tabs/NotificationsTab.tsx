"use client";

import { useState } from "react";
import { Bell, GearSix } from "@phosphor-icons/react";
import { Button } from "@heroui/react";
import { Button as UiButton, Switch, Tooltip } from "@supernote/ui";
import { useSettings } from "../SettingsContext";
import { SettingRow } from "../SettingRow";
import { SettingSection } from "../SettingSection";
import { ToggleSwitch } from "../ToggleSwitch";
import { RangeSlider } from "../RangeSlider";
import { useNotificationsContext, buildNotification } from "@supernote/notifications/renderer";
import { useOnlineSync } from "@/lib/online-sync/OnlineSyncProvider";
import {
  pushAvailability,
  subscribePush,
  unsubscribePush,
  type PushAvailability,
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
              <UiButton variant="ghost" size="icon" aria-label="Configurer le salon" onPress={onOpenSync}>
                <GearSix size={16} />
              </UiButton>
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

export function NotificationsTab({ onOpenSync }: { onOpenSync: () => void }) {
  const { settings, updateSettings } = useSettings();
  const { notifications } = settings;
  const { push } = useNotificationsContext();

  const update = (patch: Partial<typeof notifications>) =>
    updateSettings("notifications", { ...notifications, ...patch });

  const sendTestNotification = () => {
    push(buildNotification({ level: "info", title: "Test", body: "Ceci est un test" }));
  };

  return (
    <div className="space-y-6">
      <SettingSection
        title="Notifications"
        description="Configurez les alertes et messages de l'application"
        icon={<Bell size={16} />}
      >
        <SettingRow
          label="Notifications OS"
          description="Afficher les notifications système natives"
        >
          <ToggleSwitch
            checked={notifications.osNotifications}
            onChange={(v) => update({ osNotifications: v })}
          />
        </SettingRow>

        <PushRow onOpenSync={onOpenSync} />

        <SettingRow label="Sons" description="Jouer un son pour les notifications importantes">
          <ToggleSwitch
            checked={notifications.sounds}
            onChange={(v) => update({ sounds: v })}
          />
        </SettingRow>

        <SettingRow
          label="Persistance"
          description="Conserver les notifications jusqu'à leur fermeture manuelle"
        >
          <ToggleSwitch
            checked={notifications.persistence}
            onChange={(v) => update({ persistence: v })}
          />
        </SettingRow>

        <SettingRow
          label="Durée des toasts"
          description={`${notifications.toastDuration} secondes`}
        >
          <RangeSlider
            min={1}
            max={15}
            step={1}
            value={notifications.toastDuration}
            onChange={(v) => update({ toastDuration: v })}
          />
        </SettingRow>
      </SettingSection>

      <SettingSection
        title="Test"
        description="Envoyez une notification de test pour vérifier le centre de notifications"
        icon={<Bell size={16} />}
      >
        <SettingRow
          label="Notification de test"
          description="Pousse une notification info dans le centre"
        >
          <Button
            variant="ghost"
            size="sm"
            onPress={sendTestNotification}
            className="rounded-md px-3 py-1.5 text-xs font-medium"
            style={{
              backgroundColor: "var(--btn-primary-bg)",
              color: "var(--btn-primary-fg)",
            }}
          >
            Ajouter une notif test
          </Button>
        </SettingRow>
      </SettingSection>
    </div>
  );
}
