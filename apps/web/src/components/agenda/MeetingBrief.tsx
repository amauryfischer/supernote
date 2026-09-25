"use client";

import { useNavigate } from "react-router-dom";
import type { CalEventRow } from "@supernote/ipc";
import { Button } from "@supernote/ui";
import { useSettings } from "@/components/settings/SettingsContext";
import { useMailCommitments } from "@/components/mail/useMailCommitments";
import { trpc } from "@/lib/trpc/client";
import {
  BRIEF_ITEMS,
  briefPeople,
  commitmentsFor,
  localDay,
  type Attendee,
  type BriefPerson,
  type ContactRow,
  type PersonCommitment,
} from "@/lib/meeting-brief";
import { usePersonThreads } from "./useMeetingBrief";

interface Line {
  key: string;
  label: string;
  meta: string;
  late?: boolean;
  onOpen: () => void;
}

function shortDate(value: string): string {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
}

// `!` : le CSS HeroUI de .button est hors @layer et gagne sinon sur les utilitaires Tailwind.
function BriefLines({ title, lines }: { title: string; lines: Line[] }) {
  if (lines.length === 0) return null;
  return (
    <div className="flex flex-col">
      <span className="text-[11px] font-medium" style={{ color: "var(--text-muted)" }}>
        {title}
      </span>
      {lines.map((l) => (
        <Button
          key={l.key}
          variant="ghost"
          size="sm"
          onPress={l.onOpen}
          className="flex min-h-8 w-full! min-w-0 items-center justify-start! gap-2 px-1! text-left text-sm font-normal!"
        >
          <span className="min-w-0 flex-1 truncate" style={{ color: "var(--text-primary)" }}>
            {l.label}
          </span>
          {l.meta && (
            <span
              className="shrink-0 text-[11px] tabular-nums"
              style={{ color: l.late ? "var(--danger, #c0392b)" : "var(--text-muted)" }}
            >
              {l.meta}
            </span>
          )}
        </Button>
      ))}
    </div>
  );
}

function PersonBrief({
  person,
  accountId,
  commitments,
  excludeNoteId,
  statusLabel,
}: {
  person: BriefPerson;
  accountId: string;
  commitments: { mine: PersonCommitment[]; theirs: PersonCommitment[] };
  excludeNoteId: string | null;
  statusLabel: (a: Attendee) => string;
}) {
  const navigate = useNavigate();
  const threads = usePersonThreads(person.emails, accountId);
  const backlinks = trpc.entities.getBacklinks.useQuery(
    { id: person.contactId ?? "" },
    { enabled: !!person.contactId, staleTime: 60_000 },
  );
  const notes = (backlinks.data ?? [])
    .filter((b) => b.sourceTypeId === "note" && b.sourceId !== excludeNoteId)
    .slice(0, BRIEF_ITEMS);
  const today = localDay(0);
  const toLine = ({ commitment: c, threadId }: PersonCommitment): Line => ({
    key: `${threadId}:${c.key}`,
    label: c.text,
    meta: c.due ? shortDate(`${c.due}T00:00:00`) : "",
    late: !!c.due && c.due < today,
    onOpen: () => navigate(`/mail?thread=${encodeURIComponent(threadId)}`),
  });
  const hasBrief =
    commitments.mine.length + commitments.theirs.length + threads.length + notes.length > 0;

  return (
    <li className="flex flex-col gap-1">
      <div className="flex min-h-8 min-w-0 items-center gap-2 text-sm">
        {person.contactId ? (
          <Button
            variant="ghost"
            size="sm"
            onPress={() => navigate(`/contacts/${person.contactId}`)}
            className="min-h-8 min-w-0 max-w-full justify-start! px-1! text-left text-sm font-normal! underline-offset-2 hover:underline"
            style={{ color: "var(--text-primary)" }}
          >
            <span className="min-w-0 truncate">{person.name}</span>
          </Button>
        ) : (
          <span className="min-w-0 truncate" style={{ color: "var(--text-primary)" }}>
            {person.name}
          </span>
        )}
        <span className="ml-auto shrink-0 text-xs" style={{ color: "var(--text-muted)" }}>
          {statusLabel(person.attendee)}
        </span>
      </div>
      {hasBrief && (
        <div className="ml-1 flex flex-col gap-1.5 border-l pl-3" style={{ borderColor: "var(--border-subtle)" }}>
          <BriefLines title="Je lui dois" lines={commitments.mine.map(toLine)} />
          <BriefLines title="On me doit" lines={commitments.theirs.map(toLine)} />
          <BriefLines
            title="Derniers échanges"
            lines={threads.map((t) => ({
              key: t.id,
              label: t.subject || "(sans objet)",
              meta: shortDate(t.date),
              onOpen: () => navigate(`/mail?thread=${encodeURIComponent(t.id)}`),
            }))}
          />
          <BriefLines
            title="Notes"
            lines={notes.map((n) => ({
              key: n.sourceId,
              label: n.sourceTitle || "Sans titre",
              meta: "",
              onOpen: () => navigate(`/notes/${n.sourceId}`),
            }))}
          />
        </div>
      )}
    </li>
  );
}

/** Où on en est avec chaque participant : engagements, derniers échanges, notes. Tout est local. */
export function MeetingBrief({
  event,
  contacts,
  statusLabel,
}: {
  event: CalEventRow;
  contacts: ContactRow[];
  statusLabel: (a: Attendee) => string;
}) {
  const { settings } = useSettings();
  const accountId = settings.gmail.connectedEmail;
  const { all } = useMailCommitments();
  const { people, hidden } = briefPeople(event, contacts);
  if (people.length === 0) return null;
  return (
    <div className="flex flex-col gap-1">
      <span className="sn-eyebrow sn-eyebrow--compact">Participants</span>
      <ul className="flex flex-col gap-2">
        {people.map((p) => (
          <PersonBrief
            key={p.attendee.email}
            person={p}
            accountId={accountId}
            commitments={commitmentsFor(all, accountId, p.emails)}
            excludeNoteId={event.noteId}
            statusLabel={statusLabel}
          />
        ))}
      </ul>
      {hidden > 0 && (
        <span className="text-xs" style={{ color: "var(--text-muted)" }}>
          +{hidden} autre{hidden > 1 ? "s" : ""}
        </span>
      )}
    </div>
  );
}
