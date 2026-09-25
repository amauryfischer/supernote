"use client";

import { ArrowBendUpLeft, CheckSquare, Clock, X } from "@phosphor-icons/react";
import { Button, Tooltip } from "@supernote/ui";
import type { EmailThread } from "@/lib/gmail";
import { FeedbackIcon, useActionFeedback } from "@/lib/action-feedback";
import {
  acceptCommitment,
  dismissCommitment,
  followUpDraft,
  type Commitment,
  type ThreadCommitments,
} from "@/lib/mail-commitments";
import { useThreadCommitments } from "./useMailCommitments";

function dueLabel(due: string | null): string {
  if (!due) return "sans date";
  return new Date(`${due}T00:00:00`).toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" });
}

function isOverdue(due: string | null): boolean {
  if (!due) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return new Date(`${due}T00:00:00`).getTime() < today.getTime();
}

function Row({
  c,
  tc,
  messageCount,
  onDraft,
}: {
  c: Commitment;
  tc: ThreadCommitments;
  messageCount: number;
  onDraft: (text: string) => void;
}) {
  const acceptFb = useActionFeedback();
  const dismissFb = useActionFeedback();
  const mine = c.direction === "moi";
  const acceptLabel = mine ? "Créer la todo" : "Suivre : relance à l'échéance";
  const pending = c.status === "suggested";

  return (
    <li className="flex min-h-10 items-center gap-2 py-1">
      <span className="sn-eyebrow sn-eyebrow--compact shrink-0">{mine ? "Je dois" : "On me doit"}</span>
      <span className="min-w-0 flex-1 text-sm" style={{ color: "var(--text-primary)" }}>
        <span className="line-clamp-2">{c.text}</span>
        <span
          className="block text-xs tabular-nums"
          style={{ color: isOverdue(c.due) ? "var(--danger, #c0392b)" : "var(--text-muted)" }}
        >
          {c.who ? `${c.who} · ` : ""}
          {dueLabel(c.due)}
        </span>
      </span>
      {pending ? (
        <>
          <Tooltip content={acceptLabel}>
            <Button
              variant="ghost"
              size="icon"
              isIconOnly
              aria-label={acceptLabel}
              className="min-h-8 min-w-8"
              onPress={() => void acceptFb.run(() => acceptCommitment(tc, c.key, messageCount))}
            >
              <FeedbackIcon state={acceptFb.state} idle={mine ? <CheckSquare size={16} aria-hidden /> : <Clock size={16} aria-hidden />} />
            </Button>
          </Tooltip>
          <Tooltip content="Ignorer">
            <Button
              variant="ghost"
              size="icon"
              isIconOnly
              aria-label="Ignorer l'engagement"
              className="min-h-8 min-w-8"
              onPress={() => void dismissFb.run(() => dismissCommitment(tc, c.key))}
            >
              <FeedbackIcon state={dismissFb.state} idle={<X size={16} aria-hidden />} />
            </Button>
          </Tooltip>
        </>
      ) : (
        !mine &&
        isOverdue(c.due) && (
          <Tooltip content="Relancer">
            <Button
              variant="ghost"
              size="icon"
              isIconOnly
              aria-label="Relancer"
              className="min-h-8 min-w-8"
              onPress={() => onDraft(followUpDraft(c))}
            >
              <ArrowBendUpLeft size={16} aria-hidden />
            </Button>
          </Tooltip>
        )
      )}
    </li>
  );
}

/** Engagements repérés dans le fil : suggestions à valider, relances dues. */
export function CommitmentsBanner({
  thread,
  accountId,
  selfEmails,
  onDraft,
}: {
  thread: EmailThread;
  accountId: string;
  selfEmails: readonly string[];
  onDraft: (text: string) => void;
}) {
  const tc = useThreadCommitments(thread, accountId, selfEmails);
  const visible = (tc?.items ?? []).filter(
    (c) => c.status === "suggested" || (c.status === "accepted" && c.direction === "eux" && isOverdue(c.due)),
  );
  if (!tc || visible.length === 0) return null;
  return (
    <section
      aria-label="Engagements"
      className="mb-3 rounded-lg border px-3 py-1"
      style={{ borderColor: "var(--border-subtle)", background: "var(--surface-1)" }}
    >
      <ul className="flex flex-col divide-y" style={{ borderColor: "var(--border-subtle)" }}>
        {visible.map((c) => (
          <Row key={c.key} c={c} tc={tc} messageCount={thread.messages.length} onDraft={onDraft} />
        ))}
      </ul>
    </section>
  );
}
