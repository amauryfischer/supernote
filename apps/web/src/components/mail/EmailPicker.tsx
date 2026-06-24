"use client";

import { useState, useEffect, useCallback } from "react";
import { Input, Button, Spinner } from "@heroui/react";
import { MagnifyingGlass } from "@phosphor-icons/react";
import { useSettings } from "@/components/settings/SettingsContext";
import { listThreadSummaries, type ThreadListItem } from "@/lib/gmail";

/**
 * Recherche Gmail + sélection d'un thread, façon boîte mail : chaque ligne
 * montre l'expéditeur, le sujet et la date. Réutilisé par la page /mail et le
 * bloc embed (P2). Suppose Gmail connecté (l'appelant masque le picker sinon).
 *
 * `initialQuery` : si fourni, lance cette recherche au montage pour pré-remplir
 * la liste (ex. "in:inbox" = boîte de réception, emails non « done »).
 */
export function EmailPicker({
  onSelect,
  initialQuery,
}: {
  onSelect: (threadId: string) => void;
  initialQuery?: string;
}) {
  const { settings } = useSettings();
  const clientId = settings.googleDrive.clientId.trim();
  const [query, setQuery] = useState(initialQuery ?? "");
  const [results, setResults] = useState<ThreadListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);

  const run = useCallback(
    async (q?: string) => {
      const term = (q ?? query).trim();
      if (!term) return;
      setLoading(true);
      setError(null);
      try {
        setResults(await listThreadSummaries(clientId, term));
        setSearched(true);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    },
    [clientId, query],
  );

  // Pré-remplissage au montage (ex. boîte de réception par défaut). Run-once :
  // on ne veut pas relancer si `run`/`query` changent ensuite.
  useEffect(() => {
    if (initialQuery) void run(initialQuery);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-2">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void run();
          }}
          placeholder="Rechercher (ex. from:ada is:unread)"
          className="flex-1"
        />
        <Button onPress={() => void run()} isDisabled={loading}>
          <MagnifyingGlass size={16} /> Chercher
        </Button>
      </div>

      {loading && <Spinner size="sm" />}
      {error && (
        <p className="text-sm" style={{ color: "var(--color-danger, #ef4444)" }}>
          {error}
        </p>
      )}

      {!loading && results.length > 0 && (
        <div className="flex flex-col gap-1" role="listbox" aria-label="Emails">
          {results.map((t) => (
            <EmailRow key={t.id} item={t} onSelect={() => onSelect(t.id)} />
          ))}
        </div>
      )}

      {!loading && searched && results.length === 0 && !error && (
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>
          Aucun email.
        </p>
      )}
    </div>
  );
}

function EmailRow({ item, onSelect }: { item: ThreadListItem; onSelect: () => void }) {
  const sender = item.from.name || item.from.email || "(inconnu)";
  const date = item.date
    ? new Date(item.date).toLocaleDateString(undefined, { day: "2-digit", month: "short" })
    : "";
  return (
    <Button
      variant="ghost"
      onPress={onSelect}
      className="h-auto w-full justify-start whitespace-normal px-3 py-2 text-left"
    >
      <span className="flex w-full min-w-0 flex-col gap-0.5">
        <span className="flex items-baseline justify-between gap-2">
          <span className="truncate text-sm font-medium">{sender}</span>
          <span className="shrink-0 text-xs" style={{ color: "var(--text-muted)" }}>
            {date}
          </span>
        </span>
        <span className="truncate text-sm">{item.subject}</span>
        <span
          className="line-clamp-1 text-xs"
          style={{ color: "var(--text-muted)" }}
        >
          {item.snippet}
        </span>
      </span>
    </Button>
  );
}
