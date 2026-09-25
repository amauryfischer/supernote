import type { CalEventRow } from "@supernote/ipc";
import { contactEmails, findContactMatch } from "@/lib/contact-from-email";
import type { ThreadListItem } from "@/lib/gmail";
import type { Commitment, ThreadCommitments } from "@/lib/mail-commitments";

export const MAX_BRIEF_PEOPLE = 6;
export const BRIEF_ITEMS = 3;
export const BRIEF_LEAD_MS = 30 * 60_000;
const STALE_ACCEPTED_DAYS = 14;

export type Attendee = CalEventRow["attendees"][number];

export interface ContactRow {
  id: string;
  fields: Record<string, unknown>;
}

export interface BriefPerson {
  attendee: Attendee;
  name: string;
  contactId: string | null;
  /** Adresse de l'invitation + toutes celles du contact : on écrit souvent depuis deux boîtes. */
  emails: string[];
}

export interface PersonCommitment {
  commitment: Commitment;
  threadId: string;
}

const isRoom = (email: string): boolean => email.toLowerCase().endsWith("@resource.calendar.google.com");

export function localDay(offsetDays = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function briefPeople(event: CalEventRow, contacts: ContactRow[]): { people: BriefPerson[]; hidden: number } {
  const all = event.attendees.filter((a) => !a.self && !isRoom(a.email));
  const people = all.slice(0, MAX_BRIEF_PEOPLE).map((a): BriefPerson => {
    const match = findContactMatch(contacts, a.email, a.name);
    const emails = [...new Set([a.email.toLowerCase(), ...(match ? contactEmails(match.row.fields) : [])])].filter(Boolean);
    return { attendee: a, name: a.name || a.email, contactId: match?.row.id ?? null, emails };
  });
  return { people, hidden: all.length - people.length };
}

// Un « Je dois » accepté vit ensuite dans /todos : passé deux semaines, il n'éclaire plus la réunion.
function stillOpen(c: Commitment, staleBefore: string): boolean {
  if (c.status === "dismissed") return false;
  return c.status === "suggested" || !c.due || c.due >= staleBefore;
}

export function commitmentsFor(
  all: ThreadCommitments[],
  accountId: string,
  emails: readonly string[],
): { mine: PersonCommitment[]; theirs: PersonCommitment[] } {
  const wanted = new Set(emails.map((e) => e.toLowerCase()));
  const staleBefore = localDay(-STALE_ACCEPTED_DAYS);
  const open = all
    .filter((tc) => tc.accountId === accountId)
    .flatMap((tc) =>
      tc.items
        .filter((c) => wanted.has(c.whoEmail.toLowerCase()) && stillOpen(c, staleBefore))
        .map((c) => ({ commitment: c, threadId: tc.threadId })),
    );
  const byDue = (a: PersonCommitment, b: PersonCommitment) =>
    (a.commitment.due ?? "9999").localeCompare(b.commitment.due ?? "9999");
  return {
    mine: open.filter((x) => x.commitment.direction === "moi").sort(byDue),
    theirs: open.filter((x) => x.commitment.direction === "eux").sort(byDue),
  };
}

export function briefSummary(people: BriefPerson[], all: ThreadCommitments[], accountId: string): string {
  const open = people.reduce((n, p) => {
    const c = commitmentsFor(all, accountId, p.emails);
    return n + c.mine.length + c.theirs.length;
  }, 0);
  const known = people.filter((p) => p.contactId).map((p) => p.name.split(/\s+/)[0] ?? p.name).slice(0, 3);
  const parts: string[] = [];
  if (open > 0) parts.push(`${open} engagement${open > 1 ? "s" : ""} ouvert${open > 1 ? "s" : ""}`);
  if (known.length > 0) parts.push(known.join(", "));
  return parts.join(" · ");
}

export function mergeThreads(lists: ThreadListItem[][], limit = BRIEF_ITEMS): ThreadListItem[] {
  const byId = new Map<string, ThreadListItem>();
  for (const list of lists) for (const t of list) if (!byId.has(t.id)) byId.set(t.id, t);
  const time = (t: ThreadListItem) => Date.parse(t.date) || 0;
  return [...byId.values()].sort((a, b) => time(b) - time(a)).slice(0, limit);
}
