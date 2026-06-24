"use client";

import { useEffect, useState } from "react";
import type { GmailEmbedRenderProps } from "@supernote/editor";
import { useSettings } from "@/components/settings/SettingsContext";
import { getThread, type EmailThread } from "@/lib/gmail";
import { EmailThreadView } from "@/components/mail/EmailThreadView";

/** Fonction passée au provider editor : rend un thread Gmail dans un bloc note. */
export function renderGmailMessage(props: GmailEmbedRenderProps): React.ReactNode {
  return <GmailMessageView {...props} />;
}

function GmailMessageView({ threadId, url, onClear }: GmailEmbedRenderProps) {
  const { settings } = useSettings();
  const clientId = settings.googleDrive.clientId.trim();
  const [thread, setThread] = useState<EmailThread | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getThread(clientId, threadId)
      .then((t) => {
        if (!cancelled) setThread(t);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [clientId, threadId]);

  return (
    <div
      contentEditable={false}
      style={{
        borderRadius: 8,
        border: "1px solid var(--border-subtle)",
        background: "var(--surface-1)",
        padding: 12,
      }}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-xs" style={{ color: "var(--text-muted)" }}>
          Email Gmail
        </span>
        <span className="flex items-center gap-3 text-xs">
          {url && (
            <a href={url} target="_blank" rel="noopener noreferrer" style={{ color: "var(--accent)", textDecoration: "none" }}>
              Ouvrir ↗
            </a>
          )}
          {/* <button> natif : chrome interne d'un bloc éditeur self-contained
              (même exception que FallbackCard du bloc gmailMessage) — pas de
              Button HeroUI ici pour rester léger dans le rendu de bloc. */}
          <button type="button" onClick={onClear} style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer" }}>
            changer
          </button>
        </span>
      </div>
      {loading && <p className="text-sm" style={{ color: "var(--text-muted)" }}>Chargement…</p>}
      {error && <p className="text-sm" style={{ color: "var(--color-danger, #ef4444)" }}>{error}</p>}
      {!loading && !error && thread && <EmailThreadView thread={thread} />}
    </div>
  );
}
