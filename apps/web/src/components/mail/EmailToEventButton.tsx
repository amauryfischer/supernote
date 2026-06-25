"use client";

import { useMemo } from "react";
import {
  Button,
  DropdownMenu,
  useToast,
  type DropdownMenuItem,
  type ButtonProps,
} from "@supernote/ui";
import { CalendarPlus, GoogleLogo, DownloadSimple } from "@phosphor-icons/react";
import type { EmailMessage } from "@/lib/gmail";
import {
  buildGoogleCalendarUrl,
  buildIcs,
  buildEventDraft,
} from "@/lib/email-to-event";

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
  const { toast } = useToast();

  // Détecte une date pour informer l'utilisateur (toast) + label.
  const draft = useMemo(() => buildEventDraft(message), [message]);
  const hasDetectedDate = draft.start !== null;

  const openGoogleCalendar = () => {
    const url = buildGoogleCalendarUrl(message);
    const win = window.open(url, "_blank", "noopener,noreferrer");
    if (!win) {
      toast({ title: "Impossible d'ouvrir Google Agenda (popup bloquée ?)", variant: "danger" });
      return;
    }
    toast({
      title: hasDetectedDate
        ? "Google Agenda ouvert (date pré-remplie)"
        : "Google Agenda ouvert",
    });
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
      toast({ title: "Fichier .ics téléchargé" });
    } catch {
      toast({ title: "Échec de génération du fichier .ics", variant: "danger" });
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
          <CalendarPlus size={size === "sm" ? 14 : 16} />
          <span className="ml-1.5">Créer un évènement</span>
        </Button>
      }
      items={items}
    />
  );
}
