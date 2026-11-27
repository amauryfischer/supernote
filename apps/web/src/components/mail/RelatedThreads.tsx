"use client";

import { useEffect, useState } from "react";
import { CaretDown, CaretRight, ClockCounterClockwise } from "@phosphor-icons/react";
import { Button } from "@supernote/ui";
import { listThreadSummariesPage, type EmailAddress, type ThreadListItem } from "@/lib/gmail";
import { baseSubject } from "@/lib/mail-annotations";
import { formatMailDate } from "@/lib/mail-date";

// Laisser passer j/k : on ne cherche qu'une fois posé sur un fil.
const SETTLE_MS = 1500;
const PER_QUERY = 5;

interface Related {
  sameSubject: ThreadListItem[];
  withPerson: ThreadListItem[];
}

// Une recherche par fil et par session : rouvrir un fil ne refait aucun appel.
const cache = new Map<string, Related>();

/** Anciens échanges hors boîte : même objet, puis derniers fils avec le correspondant principal. */
export function RelatedThreads({
  clientId,
  threadId,
  subject,
  correspondent,
  onOpenThread,
}: {
  clientId: string;
  threadId: string;
  subject: string;
  correspondent: EmailAddress | undefined;
  onOpenThread: (threadId: string) => void;
}) {
  const [related, setRelated] = useState<Related | null>(() => cache.get(threadId) ?? null);
  const [open, setOpen] = useState(false);
  const email = correspondent?.email.toLowerCase() ?? "";
  const base = baseSubject(subject);

  useEffect(() => {
    if (cache.has(threadId)) {
      setRelated(cache.get(threadId)!);
      return undefined;
    }
    setRelated(null);
    let alive = true;
    const timer = window.setTimeout(() => {
      const quoted = base.replace(/"/g, " ").trim();
      const bySubject = quoted.length >= 6
        ? listThreadSummariesPage(clientId, `subject:"${quoted}" -in:inbox`, { maxResults: PER_QUERY + 1 }).then((p) => p.items)
        : Promise.resolve([]);
      const byPerson = email
        ? listThreadSummariesPage(clientId, `{from:${email} to:${email}} -in:inbox`, { maxResults: PER_QUERY + 1 }).then((p) => p.items)
        : Promise.resolve([]);
      void Promise.allSettled([bySubject, byPerson]).then(([s, p]) => {
        const sameSubject = (s.status === "fulfilled" ? s.value : []).filter((t) => t.id !== threadId).slice(0, PER_QUERY);
        const seen = new Set(sameSubject.map((t) => t.id));
        const withPerson = (p.status === "fulfilled" ? p.value : [])
          .filter((t) => t.id !== threadId && !seen.has(t.id))
          .slice(0, PER_QUERY);
        const result = { sameSubject, withPerson };
        // Un échec (quota, hors ligne) n'est pas mis en cache : le prochain passage retentera.
        if (s.status === "fulfilled" && p.status === "fulfilled") cache.set(threadId, result);
        if (alive) setRelated(result);
      });
    }, SETTLE_MS);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [clientId, threadId, base, email]);

  const total = (related?.sameSubject.length ?? 0) + (related?.withPerson.length ?? 0);
  if (!related || total === 0) return null;

  const group = (title: string, list: ThreadListItem[]) =>
    list.length > 0 && (
      <div className="flex flex-col">
        <p className="sn-eyebrow sn-eyebrow--compact px-2 pb-0.5 pt-1.5">{title}</p>
        {list.map((t) => (
          <Button
            key={t.id}
            variant="ghost"
            className="h-auto min-h-8 w-full justify-start gap-2 px-2 py-1 text-left font-normal"
            onPress={() => onOpenThread(t.id)}
          >
            <span className="min-w-0 flex-1 truncate text-[13px]" style={{ color: "var(--text-primary)" }}>
              {t.subject || "(sans objet)"}
            </span>
            <span className="shrink-0 font-mono text-[11px] tabular-nums" style={{ color: "var(--text-muted)" }}>
              {formatMailDate(t.date)}
            </span>
          </Button>
        ))}
      </div>
    );

  return (
    <section aria-label="Fils liés" className="rounded-[var(--radius-md)] border" style={{ borderColor: "var(--border-subtle)" }}>
      <Button
        variant="ghost"
        aria-expanded={open}
        onPress={() => setOpen((v) => !v)}
        className="h-8 min-h-8 w-full justify-start gap-1.5 px-2 text-[12.5px] font-normal"
        style={{ color: "var(--text-secondary)" }}
      >
        {open ? <CaretDown size={12} aria-hidden /> : <CaretRight size={12} aria-hidden />}
        <ClockCounterClockwise size={13} aria-hidden />
        Fils liés · {total}
      </Button>
      {open && (
        <div className="pb-1">
          {group("Même objet", related.sameSubject)}
          {group(`Avec ${correspondent?.name || email}`, related.withPerson)}
        </div>
      )}
    </section>
  );
}
