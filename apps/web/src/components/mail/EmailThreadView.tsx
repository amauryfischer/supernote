"use client";

import { useState } from "react";
import { ArrowSquareOut } from "@phosphor-icons/react";
import type { EmailThread, EmailMessage } from "@/lib/gmail";
import { parseEmailBody } from "@/lib/email-quote";

/**
 * Affichage d'un thread Gmail façon messagerie (chat) : mes messages alignés à
 * droite, ceux du correspondant à gauche. Corps en TEXTE BRUT (jamais de HTML —
 * pas de sanitizer, anti-XSS). Citation et signature retirées du corps mais
 * dépliables.
 *
 * `selfEmail` : adresse du compte connecté → détermine quels messages sont « moi »
 * (alignés à droite). Absent → tout à gauche.
 */
export function EmailThreadView({ thread, selfEmail }: { thread: EmailThread; selfEmail?: string }) {
  if (!thread.messages.length) {
    return (
      <p className="text-sm" style={{ color: "var(--text-muted)" }}>
        Thread vide.
      </p>
    );
  }
  const subject = thread.messages[0]?.subject;
  const self = (selfEmail ?? "").toLowerCase();
  return (
    <div className="flex flex-col gap-3">
      {subject && (
        <h2 className="text-base font-semibold" style={{ color: "var(--text-primary)" }}>
          {subject}
        </h2>
      )}
      {thread.messages.map((m) => (
        <MessageBubble key={m.id} message={m} mine={!!self && m.from.email.toLowerCase() === self} />
      ))}
    </div>
  );
}

function MessageBubble({ message, mine }: { message: EmailMessage; mine: boolean }) {
  const date = message.date ? new Date(message.date).toLocaleString() : "";
  const { body, quoted, signature } = parseEmailBody(message.bodyText || message.snippet);
  return (
    <div className={`flex ${mine ? "justify-end" : "justify-start"}`}>
      <div
        className="max-w-[85%] rounded-2xl border px-3.5 py-2.5"
        style={{
          backgroundColor: mine ? "var(--accent-subtle)" : "var(--surface-1)",
          borderColor: "var(--border-subtle)",
        }}
      >
        <div className="mb-1 flex items-baseline justify-between gap-3">
          <span className="truncate text-xs font-medium" style={{ color: "var(--text-primary)" }}>
            {mine ? "Moi" : message.from.name || message.from.email}
          </span>
          <span className="shrink-0 text-[11px]" style={{ color: "var(--text-muted)" }}>
            {date}
          </span>
        </div>

        {body && (
          <p className="whitespace-pre-wrap break-words text-sm" style={{ color: "var(--text-secondary)" }}>
            {body}
          </p>
        )}
        {!body && !quoted && !signature && (
          <p className="text-sm italic" style={{ color: "var(--text-muted)" }}>
            (message vide)
          </p>
        )}

        {signature && (
          <CollapsibleBlock openLabel="··· Afficher la signature" closeLabel="Masquer la signature" text={signature} />
        )}
        {quoted && (
          <CollapsibleBlock openLabel="··· Afficher la citation" closeLabel="Masquer la citation" text={quoted} />
        )}

        {message.webLink && (
          <a
            href={message.webLink}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 inline-flex items-center gap-1 text-xs"
            style={{ color: "var(--accent)", textDecoration: "none" }}
          >
            Ouvrir dans Gmail <ArrowSquareOut size={12} />
          </a>
        )}
      </div>
    </div>
  );
}

/**
 * Bloc repliable (citation / signature). Bouton natif inline — composant
 * présentational self-contained, même esprit que le lien Gmail.
 */
function CollapsibleBlock({
  openLabel,
  closeLabel,
  text,
}: {
  openLabel: string;
  closeLabel: string;
  text: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-1.5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="text-xs"
        style={{ color: "var(--text-muted)", background: "none", border: "none", cursor: "pointer", padding: 0 }}
      >
        {open ? closeLabel : openLabel}
      </button>
      {open && (
        <p
          className="mt-1 whitespace-pre-wrap break-words border-l pl-2 text-sm"
          style={{ color: "var(--text-muted)", borderColor: "var(--border-subtle)" }}
        >
          {text}
        </p>
      )}
    </div>
  );
}
