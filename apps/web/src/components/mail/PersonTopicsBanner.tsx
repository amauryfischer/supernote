"use client";

import { UsersThree } from "@phosphor-icons/react";
import { Button } from "@supernote/ui";
import type { PersonTopics } from "@/lib/mail-agenda";
import { displaySubject, type MailAnnotation } from "@/lib/mail-annotations";

const MAX_SHOWN = 3;

/** Dans le fil d'une personne : les sujets étiquetés « voir avec » elle, à traiter pendant qu'on lui parle. */
export function PersonTopicsBanner({
  topics,
  onOpenThread,
  onOpenLabel,
  annotations,
}: {
  annotations?: ReadonlyMap<string, MailAnnotation>;
  topics: PersonTopics[];
  onOpenThread: (threadId: string) => void;
  onOpenLabel: (topics: PersonTopics) => void;
}) {
  if (topics.length === 0) return null;
  return (
    <div className="flex flex-col gap-1.5">
      {topics.map((t) => (
        <section
          key={t.labelId}
          aria-label={`Sujets « ${t.labelName} »`}
          className="flex flex-col rounded-[var(--radius-md)] border px-1 py-1"
          style={{ borderColor: "var(--border-subtle)", background: "var(--surface-1)" }}
        >
          <Button
            variant="ghost"
            className="h-auto min-h-8 justify-start gap-2 px-1.5 py-1 text-left"
            onPress={() => onOpenLabel(t)}
          >
            <UsersThree size={14} aria-hidden className="shrink-0" style={{ color: "var(--sn-ember-ink)" }} />
            <span className="min-w-0 flex-1 truncate text-[13px] font-semibold" style={{ color: "var(--text-primary)" }}>
              {t.labelName.charAt(0).toUpperCase() + t.labelName.slice(1)}
            </span>
            <span className="shrink-0 text-xs" style={{ color: "var(--text-secondary)" }}>
              {t.items.length} sujet{t.items.length > 1 ? "s" : ""} en attente
            </span>
          </Button>
          <ul className="flex flex-col">
            {t.items.slice(0, MAX_SHOWN).map((it) => (
              <li key={it.id}>
                <Button
                  variant="ghost"
                  className="h-auto min-h-8 w-full justify-start px-1.5 py-1 pl-7 text-left text-[13px] font-normal"
                  style={{ color: "var(--text-secondary)" }}
                  onPress={() => onOpenThread(it.id)}
                >
                  <span className="min-w-0 truncate">{displaySubject(it.subject, it.snippet, annotations?.get(it.id)) || "(sans objet)"}</span>
                </Button>
              </li>
            ))}
          </ul>
          {t.items.length > MAX_SHOWN && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 min-h-7 justify-start px-1.5 pl-7 text-xs"
              style={{ color: "var(--text-muted)" }}
              onPress={() => onOpenLabel(t)}
            >
              Voir les {t.items.length}
            </Button>
          )}
        </section>
      ))}
    </div>
  );
}
