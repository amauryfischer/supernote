"use client";

import { useState } from "react";
import { ArrowSquareOut } from "@phosphor-icons/react";
import type { EmailThread, EmailMessage } from "@/lib/gmail";
import { splitQuotedReply } from "@/lib/email-quote";

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
  // Sépare le texte neuf de la citation rajoutée (chaîne du message d'origine)
  // pour ne montrer que la réponse ; la citation reste dépliable.
  const { body, quoted } = splitQuotedReply(message.bodyText || message.snippet);
  const [showQuote, setShowQuote] = useState(false);
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
      {body && (
        <p
          className="whitespace-pre-wrap break-words text-sm"
          style={{ color: "var(--text-secondary)" }}
        >
          {body}
        </p>
      )}
      {!body && !quoted && (
        <p className="text-sm italic" style={{ color: "var(--text-muted)" }}>
          (message vide)
        </p>
      )}
      {quoted && (
        <div className="mt-2">
          {/* Affordance inline (toggle citation) — bouton natif, composant
              présentational self-contained (même esprit que le lien Gmail). */}
          <button
            type="button"
            onClick={() => setShowQuote((v) => !v)}
            className="text-xs"
            style={{ color: "var(--text-muted)", background: "none", border: "none", cursor: "pointer", padding: 0 }}
          >
            {showQuote ? "Masquer la citation" : "··· Afficher la citation"}
          </button>
          {showQuote && (
            <p
              className="mt-1 whitespace-pre-wrap break-words border-l pl-2 text-sm"
              style={{ color: "var(--text-muted)", borderColor: "var(--border-subtle)" }}
            >
              {quoted}
            </p>
          )}
        </div>
      )}
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
