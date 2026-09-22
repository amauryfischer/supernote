"use client";

import {
  Button,
  DropdownMenu,
  type DropdownMenuItem,
  type ButtonProps,
} from "@supernote/ui";
import { CalendarPlus, GoogleLogo, DownloadSimple } from "@phosphor-icons/react";
import type { EmailMessage } from "@/lib/gmail";
import {
  buildGoogleCalendarUrl,
  buildIcs,
} from "@/lib/email-to-event";
import { useActionFeedback, FeedbackIcon } from "@/lib/action-feedback";

/**
 * EmailToEventButton — transforme un email en évènement de calendrier.
 *
 * Self-contained, aucun scope OAuth : on ne crée rien côté serveur, on ouvre
 * simplement Google Agenda pré-rempli (`window.open`) ou on télécharge un .ics.
 * La date/heure est détectée best-effort dans le corps (cf. email-to-event.ts)
 * et pré-remplit la plage. Sinon l'utilisateur la choisit dans Google/son
 * agenda.
 *
 * Pas de concept de « tâche » réutilisable côté front sans toucher au WIP
 * bases/todos (créations passant par des callbacks de page) → on s'en tient
 * volontairement à l'évènement, qui ne requiert aucune permission.
 */
export function EmailToEventButton({
  message,
  variant = "ghost",
  size = "sm",
}: {
  message: EmailMessage;
  /** Variante HeroUI du bouton déclencheur (défaut `ghost`, discret en bulle). */
  variant?: ButtonProps["variant"];
  size?: "sm" | "md";
}) {
  const fb = useActionFeedback();

  const openGoogleCalendar = () => {
    const url = buildGoogleCalendarUrl(message);
    const win = window.open(url, "_blank", "noopener,noreferrer");
    if (!win) fb.fail(new Error("Popup bloquée"));
  };

  const downloadIcs = () => {
    try {
      const ics = buildIcs(message);
      const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const safeName =
        (message.subject || "evenement")
          .replace(/[^\p{L}\p{N}-]+/gu, "-")
          .replace(/^-+|-+$/g, "")
          .slice(0, 60) || "evenement";
      a.download = `${safeName}.ics`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      // Libère l'URL objet après le clic (laisse le temps au download).
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      fb.succeed();
    } catch {
      fb.fail(new Error("Échec du fichier .ics"));
    }
  };

  const items: DropdownMenuItem[] = [
    {
      key: "gcal",
      label: "Ajouter à Google Agenda",
      startContent: <GoogleLogo size={16} />,
      onPress: openGoogleCalendar,
    },
    {
      key: "ics",
      label: "Télécharger le fichier .ics",
      startContent: <DownloadSimple size={16} />,
      onPress: downloadIcs,
    },
  ];

  return (
    <DropdownMenu
      trigger={
        <Button
          variant={variant}
          size={size}
          aria-label="Créer un évènement à partir de cet email"
        >
          <FeedbackIcon
            state={fb.state}
            error={fb.error}
            size={size === "sm" ? 14 : 16}
            idle={<CalendarPlus size={size === "sm" ? 14 : 16} />}
          />
          <span className="ml-1.5">{fb.state === "error" ? fb.error : "Créer un évènement"}</span>
        </Button>
      }
      items={items}
    />
  );
}
