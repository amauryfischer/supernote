import { useEffect, useState } from "react";
import { Spinner } from "@heroui/react";
import type { EmailSnapshot } from "@/lib/share/types";
import { formatMailDateTime } from "@/lib/mail-date";
import { fetchEmail, type Access } from "./guest-api";

export function GuestEmail({ slug, access, onLost }: { slug: string; access: Access; onLost: () => void }) {
  const [snapshot, setSnapshot] = useState<EmailSnapshot | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    setUnavailable(false);
    fetchEmail(slug, access.accessToken)
      .then((s) => (s ? setSnapshot(s) : onLost()))
      .catch(() => setUnavailable(true));
  }, [slug, access.accessToken, onLost]);

  if (unavailable) {
    return <p className="m-auto text-center text-[var(--text-secondary)]">Serveur indisponible, réessaie dans un instant.</p>;
  }
  if (!snapshot) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Spinner />
      </div>
    );
  }
  return (
    <article className="flex flex-col gap-6">
      <h1 className="break-words text-xl font-semibold [text-wrap:balance]">{snapshot.subject || "(sans objet)"}</h1>
      {snapshot.messages.map((m, i) => (
        <section key={i} className="flex flex-col gap-2 border-t border-[var(--border-subtle)] pt-4">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-sm">
            <span className="font-medium">{m.from}</span>
            <time className="text-[var(--text-muted)]">{formatMailDateTime(m.date)}</time>
          </div>
          {m.to && <p className="text-xs text-[var(--text-muted)]">À : {m.to}</p>}
          <p className="whitespace-pre-wrap break-words text-[15px] leading-relaxed">{m.bodyText}</p>
        </section>
      ))}
    </article>
  );
}
