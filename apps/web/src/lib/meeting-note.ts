import type { CalEventRow } from "@supernote/ipc";
import { noteFilePath } from "@/components/notes/adapters";
import { entityName, findContactMatch, type EntityRow } from "./contact-from-email";

export const MEETING_FOLDER = "Réunions";

const DAY = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", year: "numeric" });

/**
 * Note de réunion d'un événement. Le lien vit dans les champs de la note
 * (`gcalEventId`) : il voyage avec la synchro des entités, sans toucher Google.
 */
export function buildMeetingNote(ev: CalEventRow, contacts: EntityRow[]) {
  const title = `${ev.summary} — ${DAY.format(ev.startAt)}`;
  const people = ev.attendees
    .filter((a) => !a.self)
    .map((a) => {
      const match = findContactMatch(contacts, a.email, a.name);
      const name = match ? entityName(match.row) : "";
      return name ? `@${name}` : a.name || a.email;
    });
  const header = [
    people.length > 0 ? `Participants : ${people.join(", ")}` : "",
    ev.meetUrl ? `Visio : ${ev.meetUrl}` : ev.location ? `Lieu : ${ev.location}` : "",
  ].filter(Boolean);
  const body = [...header, ...(header.length ? [""] : []), "## Ordre du jour", "", "## Notes", "", "## Actions", "", "- [ ] "].join("\n");
  return {
    title,
    filePath: noteFilePath(MEETING_FOLDER, title),
    fields: {
      title,
      gcalEventId: ev.id,
      gcalCalendarId: ev.calendarId,
      eventStart: new Date(ev.startAt).toISOString(),
    },
    body,
  };
}
