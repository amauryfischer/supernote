import { useEffect, useState } from "react";
import type { EmailSnapshot } from "@/lib/share/types";
import { fetchEmail, type Access } from "./guest-api";

const dateFmt = new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short" });

export function GuestEmail({ slug, access, onLost }: { slug: string; access: Access; onLost: () => void }) {
  const [snapshot, setSnapshot] = useState<EmailSnapshot | null>(null);

  useEffect(() => {
    void fetchEmail(slug, access.accessToken).then((s) => (s ? setSnapshot(s) : onLost()));
  }, [slug, access.accessToken, onLost]);

  if (!snapshot) return null;
  return (
    <article className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold [text-wrap:balance]">{snapshot.subject || "(sans objet)"}</h1>
      {snapshot.messages.map((m, i) => (
        <section key={i} className="flex flex-col gap-2 border-t border-[var(--border-subtle)] pt-4">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-sm">
            <span className="font-medium">{m.from}</span>
            <time className="text-[var(--text-muted)]">{m.date ? dateFmt.format(new Date(m.date)) : ""}</time>
          </div>
          {m.to && <p className="text-xs text-[var(--text-muted)]">À : {m.to}</p>}
          <p className="whitespace-pre-wrap break-words text-[15px] leading-relaxed">{m.bodyText}</p>
        </section>
      ))}
    </article>
  );
}
