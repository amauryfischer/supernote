"use client";

import { useEffect, useState } from "react";
import { BellRinging, X } from "@phosphor-icons/react";
import { Button, Tooltip } from "@supernote/ui";
import { useSettings } from "@/components/settings/SettingsContext";
import { useOnlineSync } from "@/lib/online-sync/OnlineSyncProvider";
import { useActionFeedback, FeedbackIcon } from "@/lib/action-feedback";
import {
  dismissMailGrantPrompt,
  grantMailAccess,
  mailGrantEmail,
  mailGrantPromptDismissed,
} from "@/lib/mail-push-watch";
import {
  dismissPushPrompt,
  fetchPushConfig,
  pushAvailability,
  pushPromptState,
  subscribePush,
} from "@/lib/push/push-client";

const COPY = {
  ask: "Reçois tes mails, rappels et relances même Supernote fermé.",
  protect: "Protège ton salon par un mot de passe pour recevoir les notifications app fermée.",
  install: "Ajoute Supernote à l'écran d'accueil pour recevoir les notifications.",
  grant: "Affiche l'expéditeur et l'objet des mails dans les notifications, même Supernote fermé.",
} as const;

export function PushPromptBanner({ onOpenSync }: { onOpenSync: () => void }) {
  const { settings, updateSettings } = useSettings();
  const online = useOnlineSync();
  const [state, setState] = useState(() => pushPromptState(online?.config));
  const [grantable, setGrantable] = useState(false);
  const fb = useActionFeedback();
  const clientId = settings.googleDrive.clientId.trim();

  // Push déjà actif : le consentement Google hors ligne est la dernière marche, une seule fois.
  useEffect(() => {
    if (state !== "hidden" || !clientId || mailGrantEmail() || mailGrantPromptDismissed()) return undefined;
    if (typeof Notification === "undefined" || Notification.permission !== "granted") return undefined;
    if (pushAvailability(online?.config) !== "ok") return undefined;
    let alive = true;
    void fetchPushConfig(online?.config)
      .then((c) => alive && setGrantable(c.mailGrant))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [state, clientId, online?.config]);

  // Laisse la coche s'afficher avant de replier le bandeau.
  useEffect(() => {
    if (fb.state !== "success") return;
    const timer = setTimeout(() => {
      if (state === "hidden") setGrantable(false);
      else setState("hidden");
    }, 1200);
    return () => clearTimeout(timer);
  }, [fb.state, state]);

  const mode = state !== "hidden" ? state : grantable ? "grant" : "hidden";
  if (!settings.notifications.pushSubscribed || mode === "hidden") return null;

  const activate = () =>
    void fb.run(async () => {
      if (mode === "grant") {
        await grantMailAccess(clientId, online?.config);
        return;
      }
      await subscribePush(online?.config);
      updateSettings("notifications", { ...settings.notifications, pushSubscribed: true });
    });

  return (
    <div
      role="region"
      aria-label="Notifications"
      className="mx-4 my-2 flex items-center gap-3 rounded-lg border px-3 py-2 text-sm md:mx-2"
      style={{ borderColor: "var(--border)" }}
    >
      <BellRinging size={18} aria-hidden />
      <p className="min-w-0 flex-1">{fb.error ?? COPY[mode]}</p>
      {(mode === "ask" || mode === "grant") && (
        <Button size="sm" isDisabled={fb.isPending} onPress={activate}>
          <FeedbackIcon state={fb.state} error={fb.error} size={14} idle={null} />
          Activer
        </Button>
      )}
      {mode === "protect" && (
        <Button size="sm" variant="ghost" onPress={onOpenSync}>
          Protéger le salon
        </Button>
      )}
      <Tooltip content="Plus tard">
        <Button
          variant="ghost"
          size="icon"
          className="sn-hit"
          aria-label="Plus tard"
          onPress={() => {
            if (mode === "grant") {
              dismissMailGrantPrompt();
              setGrantable(false);
            } else {
              dismissPushPrompt();
              setState("hidden");
            }
          }}
        >
          <X size={16} />
        </Button>
      </Tooltip>
    </div>
  );
}
