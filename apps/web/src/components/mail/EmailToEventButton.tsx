"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Button,
  DropdownMenu,
  type DropdownMenuItem,
  type ButtonProps,
} from "@supernote/ui";
import { CalendarBlank, CalendarPlus, GoogleLogo, DownloadSimple } from "@phosphor-icons/react";
import { useSettings } from "@/components/settings/SettingsContext";
import { useIsMobile } from "@/hooks/useIsMobile";
import { EventEditorModal } from "@/components/agenda/EventEditorModal";
import { useEventWrites } from "@/components/agenda/useEventWrites";
import { calListCalendars } from "@/lib/calendar-mirror";
import { calendarAccount, isCalendarConnected } from "@/lib/calendar-sync";
import { mirrorAvailable } from "@/lib/mail-mirror";
import type { EmailMessage } from "@/lib/gmail";
import {
  buildGoogleCalendarUrl,
  buildIcs,
  buildEventDraft,
} from "@/lib/email-to-event";
import { useActionFeedback, FeedbackIcon } from "@/lib/action-feedback";

/**
 * EmailToEventButton — transforme un email en évènement de calendrier.
 *
 * Agenda connecté : l'éditeur d'événement s'ouvre pré-rempli et l'événement
 * part par la file d'écriture de l'agenda. Sinon, sans scope OAuth : Google
 * Agenda pré-rempli (`window.open`) ou un .ics.
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
  const isMobile = useIsMobile();
  const { settings } = useSettings();
  const accountId = calendarAccount(settings)?.accountId ?? "";
  const agendaReady = !!accountId && isCalendarConnected() && mirrorAvailable();
  const [editorOpen, setEditorOpen] = useState(false);
  const writes = useEventWrites(accountId);
  const calendars = useQuery({
    queryKey: ["calendar", "calendars", accountId],
    queryFn: () => calListCalendars(accountId),
    enabled: agendaReady && editorOpen,
  });

  const draft = useMemo(() => buildEventDraft(message), [message]);

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
    ...(agendaReady
      ? [
          {
            key: "agenda",
            label: "Créer dans l'agenda",
            startContent: <CalendarBlank size={16} />,
            onPress: () => setEditorOpen(true),
          },
        ]
      : []),
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

  const start = draft.start?.getTime() ?? Math.ceil(Date.now() / 1_800_000) * 1_800_000;

  return (
    <>
    {editorOpen && (
      <EventEditorModal
        isOpen
        isMobile={isMobile}
        mode="create"
        calendars={calendars.data ?? []}
        initial={{
          summary: draft.title,
          description: draft.details,
          startAt: start,
          endAt: draft.end?.getTime() ?? start + 3_600_000,
        }}
        onClose={() => setEditorOpen(false)}
        onSave={async (d) => {
          await writes.create(d);
          fb.succeed();
        }}
      />
    )}
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
    </>
  );
}
