"use client";

import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { CalCalendarRow, CalEventRow } from "@supernote/ipc";
import { ArrowSquareOut, CalendarX, CheckSquare, MapPin, NotePencil, PencilSimple, Trash, VideoCamera, X } from "@phosphor-icons/react";
import { Button, Tooltip, useToast } from "@supernote/ui";
import { trpc } from "@/lib/trpc/client";
import { findContactMatch } from "@/lib/contact-from-email";
import { buildMeetingNote } from "@/lib/meeting-note";
import { emitCalendarChanged } from "@/lib/calendar-mirror";
import { formatDayLong, formatSpan } from "@/lib/agenda/dates";
import { taskSourcePath } from "@/lib/agenda/task-ref";
import { calendarColor, canEditCalendar } from "./EventBlock";
import type { RsvpResponse } from "./useEventWrites";

const RESPONSE_LABEL: Record<string, string> = {
  accepted: "Oui",
  tentative: "Peut-être",
  declined: "Non",
  needsAction: "En attente",
};

interface EventDetailProps {
  event: CalEventRow;
  calendars: CalCalendarRow[];
  onClose: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onRsvp: (response: RsvpResponse) => void;
  /** Bloc de tâche : remplace « Supprimer ». */
  onUnschedule?: () => void;
}

export function EventDetail({ event, calendars, onClose, onEdit, onDelete, onRsvp, onUnschedule }: EventDetailProps) {
  const navigate = useNavigate();
  const calendar = calendars.find((c) => c.id === event.calendarId);
  const editable = canEditCalendar(calendars, event.calendarId);
  const self = event.attendees.find((a) => a.self);
  const invited = !!self && !self.organizer;
  const others = event.attendees.filter((a) => !a.self);
  const taskPath = event.sourceRef ? taskSourcePath(event.sourceRef) : null;

  const contactsQuery = trpc.entities.listSummaries.useQuery(
    { typeId: "personne", limit: 2000, offset: 0 },
    { enabled: others.length > 0, staleTime: 60_000 },
  );
  const contacts = useMemo(
    () => (contactsQuery.data?.items ?? []).map((c) => ({ id: c.id, fields: (c.fields ?? {}) as Record<string, unknown> })),
    [contactsQuery.data],
  );

  const { toast } = useToast();
  const utils = trpc.useUtils();
  const createNote = trpc.entities.create.useMutation();
  const [openingNote, setOpeningNote] = useState(false);
  const openMeetingNote = async () => {
    if (event.noteId) {
      navigate(`/notes/${event.noteId}`);
      return;
    }
    setOpeningNote(true);
    try {
      const people = await utils.entities.listSummaries.fetch({ typeId: "personne", limit: 2000, offset: 0 });
      const note = buildMeetingNote(
        event,
        people.items.map((c) => ({ id: c.id, fields: (c.fields ?? {}) as Record<string, unknown> })),
      );
      const created = await createNote.mutateAsync({
        typeId: "note",
        fields: { ...note.fields, filePath: note.filePath },
        body: note.body,
      });
      void utils.vault.folders.list.invalidate();
      void utils.entities.list.invalidate();
      emitCalendarChanged();
      navigate(`/notes/${created.id}`);
    } catch (err) {
      toast({
        title: "Impossible de créer la note de réunion",
        description: err instanceof Error ? err.message : String(err),
        variant: "danger",
      });
    } finally {
      setOpeningNote(false);
    }
  };

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex items-start gap-2">
        <span aria-hidden className="mt-1.5 h-3 w-3 shrink-0 rounded-sm" style={{ background: calendarColor(calendars, event.calendarId) }} />
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold" style={{ color: "var(--text-primary)" }}>
            {event.summary}
          </h2>
          <p className="text-sm capitalize" style={{ color: "var(--text-secondary)" }}>
            {formatDayLong(event.startAt)} · {formatSpan(event)}
          </p>
          {calendar && (
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>
              {calendar.summary}
              {event.pending ? " · en attente d'envoi" : ""}
            </p>
          )}
        </div>
        <Tooltip content="Fermer">
          <Button variant="ghost" size="icon" isIconOnly aria-label="Fermer le détail" onPress={onClose}>
            <X size={16} aria-hidden />
          </Button>
        </Tooltip>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {event.meetUrl && (
          <Button variant="primary" size="sm" onPress={() => window.open(event.meetUrl, "_blank", "noopener")}>
            <VideoCamera size={16} aria-hidden />
            Rejoindre
          </Button>
        )}
        <Tooltip content={event.id.startsWith("local-") ? "Disponible une fois l'événement envoyé à Google" : event.noteId ? "Ouvrir la note liée" : "Créer la note liée dans Réunions/"}>
          <Button
            variant="outline"
            size="sm"
            onPress={() => void openMeetingNote()}
            isDisabled={event.id.startsWith("local-")}
            isLoading={openingNote}
          >
            <NotePencil size={16} aria-hidden />
            Note de réunion
          </Button>
        </Tooltip>
        {taskPath && (
          <Button variant="outline" size="sm" onPress={() => navigate(taskPath)}>
            <CheckSquare size={16} aria-hidden />
            Ouvrir la tâche
          </Button>
        )}
      </div>

      {event.location && (
        <p className="flex items-start gap-2 text-sm" style={{ color: "var(--text-secondary)" }}>
          <MapPin size={16} aria-hidden className="mt-0.5 shrink-0" />
          <span className="min-w-0 break-words">{event.location}</span>
        </p>
      )}

      {invited && (
        <div className="flex flex-col gap-1.5">
          <span className="sn-eyebrow sn-eyebrow--compact">Ta réponse</span>
          <div className="flex flex-wrap gap-1.5">
            {(["accepted", "tentative", "declined"] as const).map((r) => (
              <Button
                key={r}
                size="sm"
                variant={event.selfResponse === r ? "primary" : "outline"}
                aria-pressed={event.selfResponse === r}
                onPress={() => onRsvp(r)}
              >
                {RESPONSE_LABEL[r]}
              </Button>
            ))}
          </div>
        </div>
      )}

      {others.length > 0 && (
        <div className="flex flex-col gap-1">
          <span className="sn-eyebrow sn-eyebrow--compact">Participants</span>
          <ul className="flex flex-col">
            {others.map((a) => {
              const match = findContactMatch(contacts, a.email, a.name);
              return (
                <li key={a.email} className="flex min-h-8 items-center gap-2 text-sm">
                  {match ? (
                    <button
                      type="button"
                      onClick={() => navigate(`/contacts/${match.row.id}`)}
                      className="min-w-0 truncate text-left underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-[var(--border-focus)]"
                      style={{ color: "var(--text-primary)" }}
                    >
                      {a.name || a.email}
                    </button>
                  ) : (
                    <span className="min-w-0 truncate" style={{ color: "var(--text-primary)" }}>
                      {a.name || a.email}
                    </span>
                  )}
                  <span className="ml-auto shrink-0 text-xs" style={{ color: "var(--text-muted)" }}>
                    {a.organizer ? "Organisateur" : RESPONSE_LABEL[a.responseStatus] ?? a.responseStatus}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {event.description && (
        <p className="whitespace-pre-wrap break-words text-sm" style={{ color: "var(--text-secondary)" }}>
          {event.description.replace(/<[^>]+>/g, "")}
        </p>
      )}

      {event.recurringEventId && (
        <p className="text-xs" style={{ color: "var(--text-muted)" }}>
          Occurrence d'une série : la série entière se modifie dans Google Agenda.
        </p>
      )}

      <div className="flex flex-wrap gap-1.5 border-t pt-3" style={{ borderColor: "var(--border-subtle)" }}>
        {editable && (
          <Button variant="outline" size="sm" onPress={onEdit}>
            <PencilSimple size={14} aria-hidden />
            Modifier
          </Button>
        )}
        {event.htmlLink && (
          <Button variant="ghost" size="sm" onPress={() => window.open(event.htmlLink, "_blank", "noopener")}>
            <ArrowSquareOut size={14} aria-hidden />
            Ouvrir dans Google Agenda
          </Button>
        )}
        {editable &&
          (event.sourceRef && onUnschedule ? (
            <Button variant="ghost" size="sm" onPress={onUnschedule} className="ml-auto">
              <CalendarX size={14} aria-hidden />
              Retirer du planning
            </Button>
          ) : (
            <Button variant="ghost" size="sm" onPress={onDelete} className="ml-auto">
              <Trash size={14} aria-hidden />
              Supprimer
            </Button>
          ))}
      </div>
    </div>
  );
}
