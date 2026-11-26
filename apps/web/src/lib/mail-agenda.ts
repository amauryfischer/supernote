import type { CalEventRow } from "@supernote/ipc";
import type { ThreadListItem } from "@/lib/gmail";

export interface MeetingAgenda {
  event: CalEventRow;
  labelId: string;
  labelName: string;
  /** Fils de la boîte qui portent le label, du plus ancien au plus récent. */
  items: ThreadListItem[];
  oldestDays: number;
}

export const AGENDA_HORIZON_MS = 7 * 86_400_000;

const tokens = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

// « voir avec paul », « todo melvin » : le sujet attend une personne, pas une réunion nommée.
const PERSON_LABEL = /^(?:a )?(?:voir avec|todo)\s+(.+)$/;

function matches(labelName: string, ev: CalEventRow): boolean {
  const label = tokens(labelName);
  const title = new Set(tokens(ev.summary));
  const person = PERSON_LABEL.exec(label.join(" "))?.[1]?.split(" ");
  if (person) {
    if (person.every((t) => title.has(t))) return true;
    const others = ev.attendees.filter((a) => !a.self);
    // Au-delà du tête-à-tête, la personne est seulement présente : ce n'est pas « son » créneau.
    return others.length === 1 && person.every((t) => tokens(`${others[0]!.name} ${others[0]!.email.split("@")[0]}`).includes(t));
  }
  // Un label d'un seul mot court (« dev ») accrocherait trop de titres.
  return label.join("").length >= 4 && label.every((t) => title.has(t));
}

/**
 * Ordres du jour : pour chaque label de la boîte, la prochaine réunion de l'agenda qui lui correspond
 * dans l'horizon. Rapprochement par les mots du label et du titre (ou par le participant d'un
 * tête-à-tête), jamais deviné par l'IA. Un label sans réunion à venir ne donne rien.
 */
export function meetingAgendas(
  events: readonly CalEventRow[],
  items: readonly ThreadListItem[],
  labelNames: ReadonlyMap<string, string>,
  now: number,
): MeetingAgenda[] {
  const upcoming = events
    .filter((e) => !e.allDay && e.status !== "cancelled" && e.endAt > now && e.startAt - now <= AGENDA_HORIZON_MS)
    .sort((a, b) => a.startAt - b.startAt);
  if (upcoming.length === 0) return [];
  const byLabel = new Map<string, ThreadListItem[]>();
  for (const it of items) {
    for (const id of it.labelIds) {
      if (!labelNames.has(id)) continue;
      const list = byLabel.get(id);
      if (list) list.push(it);
      else byLabel.set(id, [it]);
    }
  }
  const out: MeetingAgenda[] = [];
  for (const [labelId, list] of byLabel) {
    const labelName = labelNames.get(labelId)!;
    const event = upcoming.find((e) => matches(labelName, e));
    if (!event) continue;
    const sorted = [...list].sort((a, b) => a.date.localeCompare(b.date));
    const oldest = new Date(sorted[0]!.date).getTime();
    out.push({
      event,
      labelId,
      labelName,
      items: sorted,
      oldestDays: Number.isFinite(oldest) ? Math.max(0, Math.floor((now - oldest) / 86_400_000)) : 0,
    });
  }
  return out.sort((a, b) => a.event.startAt - b.event.startAt || b.items.length - a.items.length);
}

/** « aujourd'hui 14:00 », « demain 09:30 », « jeu. 14:00 ». */
export function meetingWhen(startAt: number, now: number): string {
  const day = (ms: number) => new Date(ms).setHours(0, 0, 0, 0);
  const diff = Math.round((day(startAt) - day(now)) / 86_400_000);
  const time = new Date(startAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  if (startAt <= now) return "en cours";
  if (diff === 0) return `aujourd'hui ${time}`;
  if (diff === 1) return `demain ${time}`;
  return `${new Date(startAt).toLocaleDateString("fr-FR", { weekday: "short" })} ${time}`;
}
