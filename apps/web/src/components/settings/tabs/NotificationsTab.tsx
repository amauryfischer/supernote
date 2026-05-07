"use client";

import { Bell } from "@phosphor-icons/react";
import { useSettings } from "../SettingsContext";
import { SettingRow } from "../SettingRow";
import { SettingSection } from "../SettingSection";
import { ToggleSwitch } from "../ToggleSwitch";
import { RangeSlider } from "../RangeSlider";

export function NotificationsTab() {
  const { settings, updateSettings } = useSettings();
  const { notifications } = settings;

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
    </div>
  );
}
