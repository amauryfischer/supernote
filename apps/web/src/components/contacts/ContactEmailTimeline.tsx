"use client";

/**
 * ContactEmailTimeline — vue « 360 » des échanges email d'un contact / org.
 *
 * À partir d'une ou plusieurs adresses email, construit une requête Gmail
 * (`from:x OR to:x …`, cf. `buildContactMailQuery`) et liste les threads
 * échangés (`listThreadSummaries`). Affiche une timeline (récent → ancien) avec,
 * pour chaque thread : sujet, date, aperçu, et un marqueur de SENS entrant/
 * sortant déduit du `From` vs `selfEmail`. Un clic ouvre le thread complet
 * (réutilise `EmailThreadView`, l'affichage chat partagé avec /mail).
 *
 * Self-contained : aucun wiring global. Les props portent tout le contexte
 *  - `clientId`  : Client ID OAuth Google (réutilisé depuis Google Drive) ;
 *  - `emails`    : adresses du contact (≥1 pour déclencher la recherche) ;
 *  - `selfEmail` : compte connecté → détermine le sens + l'alignement chat.
 *
 * Corps en texte brut (via EmailThreadView) — jamais de HTML (anti-XSS).
 * Mobile : pleine largeur, cibles tactiles ≥ 36px, pas de débordement.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Spinner } from "@heroui/react";
import {
  ArrowDownLeft,
  ArrowUpRight,
  ArrowsClockwise,
  CaretLeft,
  EnvelopeSimple,
} from "@phosphor-icons/react";
import {
  listThreadSummaries,
  getThread,
  type EmailThread,
} from "@/lib/gmail";
import { EmailThreadView } from "@/components/mail/EmailThreadView";
import {
  buildContactMailQuery,
  toContactTimeline,
  contactMailStats,
  type ContactMailEntry,
  type MailDirection,
} from "@/lib/contact-mail";

export interface ContactEmailTimelineProps {
  /** Client ID OAuth Google (réutilisé depuis les réglages Google Drive). */
  clientId: string;
  /** Adresses email du contact. Au moins une pour déclencher la recherche. */
  emails: string[];
  /** Email du compte Gmail connecté → sens entrant/sortant + alignement chat. */
  selfEmail?: string;
  /** Nombre max de threads remontés (défaut 30). */
  maxResults?: number;
}

type LoadState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; entries: ContactMailEntry[] };

function formatTimelineDate(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" });
}

/** Pastille de sens (entrant/sortant), avec libellé accessible. */
function DirectionBadge({ direction }: { direction: MailDirection }) {
  if (direction === "unknown") return null;
  const outgoing = direction === "outgoing";
  const label = outgoing ? "Envoyé" : "Reçu";
  return (
    <span
      title={label}
      aria-label={label}
      className="inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium"
      style={{
        backgroundColor: outgoing ? "var(--accent-subtle)" : "var(--surface-2)",
        color: outgoing ? "var(--accent)" : "var(--text-muted)",
      }}
    >
      {outgoing ? <ArrowUpRight size={10} weight="bold" /> : <ArrowDownLeft size={10} weight="bold" />}
      {label}
    </span>
  );
}

export function ContactEmailTimeline({
  clientId,
  emails,
  selfEmail,
  maxResults = 30,
}: ContactEmailTimelineProps) {
  const [state, setState] = useState<LoadState>({ status: "idle" });
  const [openThreadId, setOpenThreadId] = useState<string | null>(null);
  const [thread, setThread] = useState<EmailThread | null>(null);
  const [threadLoading, setThreadLoading] = useState(false);
  const [threadError, setThreadError] = useState<string | null>(null);

  const query = useMemo(() => buildContactMailQuery(emails), [emails]);
  const trimmedClientId = clientId.trim();
  const canSearch = Boolean(trimmedClientId) && Boolean(query);

  const loadList = useCallback(async () => {
    if (!canSearch) return;
    setState({ status: "loading" });
    try {
      const items = await listThreadSummaries(trimmedClientId, query, maxResults);
      setState({ status: "ready", entries: toContactTimeline(items, selfEmail) });
    } catch (err) {
      setState({ status: "error", message: err instanceof Error ? err.message : String(err) });
    }
  }, [canSearch, trimmedClientId, query, maxResults, selfEmail]);

  useEffect(() => {
    if (canSearch) void loadList();
    else setState({ status: "idle" });
    // Reset thread view when the source query changes.
    setOpenThreadId(null);
    setThread(null);
    setThreadError(null);
  }, [canSearch, loadList]);

  const openThread = useCallback(
    async (threadId: string) => {
      setOpenThreadId(threadId);
      setThread(null);
      setThreadError(null);
      setThreadLoading(true);
      try {
        setThread(await getThread(trimmedClientId, threadId));
      } catch (err) {
        setThreadError(err instanceof Error ? err.message : String(err));
      } finally {
        setThreadLoading(false);
      }
    },
    [trimmedClientId],
  );

  // ── Gate : pas de client / pas d'adresse ──────────────────────────────────
  if (!trimmedClientId) {
    return (
      <EmptyHint icon>
        Connectez Gmail dans les réglages pour voir l'historique des échanges avec ce contact.
      </EmptyHint>
    );
  }
  if (!query) {
    return <EmptyHint icon>Aucune adresse email enregistrée pour ce contact.</EmptyHint>;
  }

  // ── Vue thread (détail) ────────────────────────────────────────────────────
  if (openThreadId) {
    return (
      <div className="flex flex-col gap-3">
        <Button
          variant="ghost"
          size="sm"
          onPress={() => {
            setOpenThreadId(null);
            setThread(null);
            setThreadError(null);
          }}
          className="flex h-auto w-fit items-center gap-1.5 px-2 py-1.5 text-xs font-medium"
          style={{ color: "var(--text-muted)" }}
        >
          <CaretLeft size={12} /> Retour à la timeline
        </Button>

        {threadLoading && (
          <div className="flex items-center gap-2 py-6 text-sm" style={{ color: "var(--text-muted)" }}>
            <Spinner size="sm" /> Chargement du fil…
          </div>
        )}
        {threadError && (
          <p className="py-6 text-sm" style={{ color: "var(--danger)" }}>
            Impossible de charger ce fil : {threadError}
          </p>
        )}
        {thread && <EmailThreadView thread={thread} selfEmail={selfEmail} enableShortcuts={false} />}
      </div>
    );
  }

  // ── Vue liste (timeline) ───────────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-3">
      <TimelineHeader
        state={state}
        onRefresh={() => void loadList()}
      />

      {state.status === "loading" && (
        <div className="flex items-center gap-2 py-6 text-sm" style={{ color: "var(--text-muted)" }}>
          <Spinner size="sm" /> Recherche des échanges…
        </div>
      )}

      {state.status === "error" && (
        <div className="flex flex-col items-start gap-2 py-4">
          <p className="text-sm" style={{ color: "var(--danger)" }}>
            Erreur Gmail : {state.message}
          </p>
          <Button size="sm" variant="ghost" onPress={() => void loadList()} className="text-xs">
            Réessayer
          </Button>
        </div>
      )}

      {state.status === "ready" && state.entries.length === 0 && (
        <EmptyHint>Aucun échange email trouvé avec ce contact.</EmptyHint>
      )}

      {state.status === "ready" && state.entries.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          {state.entries.map((e) => (
            <li key={e.id}>
              <Button
                variant="ghost"
                onPress={() => void openThread(e.id)}
                className="flex h-auto w-full flex-col items-stretch gap-1 rounded-lg border px-3 py-2.5 text-left"
                style={{ borderColor: "var(--border-subtle)", backgroundColor: "var(--surface-1)" }}
              >
                <div className="flex items-center justify-between gap-2">
                  <span
                    className="min-w-0 flex-1 truncate text-sm font-medium"
                    style={{ color: "var(--text-primary)" }}
                  >
                    {e.subject}
                  </span>
                  <span className="shrink-0 text-[11px]" style={{ color: "var(--text-muted)" }}>
                    {formatTimelineDate(e.date)}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <DirectionBadge direction={e.direction} />
                  <span className="min-w-0 flex-1 truncate text-xs" style={{ color: "var(--text-muted)" }}>
                    {e.snippet || e.fromName}
                  </span>
                </div>
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function TimelineHeader({ state, onRefresh }: { state: LoadState; onRefresh: () => void }) {
  const stats = state.status === "ready" ? contactMailStats(state.entries) : null;
  return (
    <div className="flex items-center justify-between gap-2">
      <div className="flex min-w-0 items-center gap-2 text-xs" style={{ color: "var(--text-muted)" }}>
        <EnvelopeSimple size={14} />
        {stats ? (
          <span className="truncate">
            {stats.total} échange{stats.total > 1 ? "s" : ""}
            {stats.total > 0 && ` · ${stats.incoming} reçu${stats.incoming > 1 ? "s" : ""} · ${stats.outgoing} envoyé${stats.outgoing > 1 ? "s" : ""}`}
          </span>
        ) : (
          <span>Échanges email</span>
        )}
      </div>
      <Button
        isIconOnly
        variant="ghost"
        size="sm"
        onPress={onRefresh}
        isDisabled={state.status === "loading"}
        aria-label="Rafraîchir"
        className="h-8 w-8 min-h-0 min-w-0 shrink-0"
        style={{ color: "var(--text-muted)" }}
      >
        <ArrowsClockwise size={14} />
      </Button>
    </div>
  );
}

function EmptyHint({ children, icon }: { children: React.ReactNode; icon?: boolean }) {
  return (
    <div
      className="flex flex-col items-center gap-2 rounded-lg border border-dashed px-4 py-8 text-center"
      style={{ borderColor: "var(--border-subtle)" }}
    >
      {icon && <EnvelopeSimple size={22} style={{ color: "var(--text-muted)" }} />}
      <p className="text-sm" style={{ color: "var(--text-muted)" }}>
        {children}
      </p>
    </div>
  );
}
