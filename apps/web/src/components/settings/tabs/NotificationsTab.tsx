"use client";

import { Bell } from "@phosphor-icons/react";
import { Button } from "@heroui/react";
import { useSettings } from "../SettingsContext";
import { SettingRow } from "../SettingRow";
import { SettingSection } from "../SettingSection";
import { ToggleSwitch } from "../ToggleSwitch";
import { RangeSlider } from "../RangeSlider";
import { useNotificationsContext, buildNotification } from "@supernote/notifications/renderer";

export function NotificationsTab() {
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
              backgroundColor: "var(--accent)",
              color: "var(--accent-foreground)",
            }}
          >
            Ajouter une notif test
          </Button>
        </SettingRow>
      </SettingSection>
    </div>
  );
}
