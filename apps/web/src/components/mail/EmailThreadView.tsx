"use client";

import { ArrowSquareOut } from "@phosphor-icons/react";
import type { EmailThread, EmailMessage } from "@/lib/gmail";

/**
 * Affichage lecture seule d'un thread Gmail. Corps rendu en TEXTE BRUT
 * (whitespace-pre-wrap) — JAMAIS de HTML en P1 (aucune sanitisation dispo →
 * éviter tout XSS). Lien "Ouvrir dans Gmail" pour le rendu riche.
 */
export function EmailThreadView({ thread }: { thread: EmailThread }) {
  if (!thread.messages.length) {
    return (
      <p className="text-sm" style={{ color: "var(--text-muted)" }}>
        Thread vide.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      {thread.messages.map((m) => (
        <MessageCard key={m.id} message={m} />
      ))}
    </div>
  );
}

function MessageCard({ message }: { message: EmailMessage }) {
  const date = message.date ? new Date(message.date).toLocaleString() : "";
  return (
    <div
      className="rounded-lg border p-4"
      style={{
        borderColor: "var(--border-subtle)",
        backgroundColor: "var(--surface-1)",
      }}
    >
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
          {message.from.name || message.from.email}
        </span>
        <span className="text-xs" style={{ color: "var(--text-muted)" }}>
          {date}
        </span>
      </div>
      {message.subject && (
        <p className="mb-2 text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
          {message.subject}
        </p>
      )}
      <p
        className="whitespace-pre-wrap break-words text-sm"
        style={{ color: "var(--text-secondary)" }}
      >
        {message.bodyText || message.snippet}
      </p>
      {message.webLink && (
        <a
          href={message.webLink}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 inline-flex items-center gap-1 text-xs"
          style={{ color: "var(--accent)", textDecoration: "none" }}
        >
          Ouvrir dans Gmail <ArrowSquareOut size={12} />
        </a>
      )}
    </div>
  );
}
