"use client";

import { useState } from "react";
import { Input, Button, Spinner } from "@heroui/react";
import { MagnifyingGlass } from "@phosphor-icons/react";
import { useSettings } from "@/components/settings/SettingsContext";
import { searchThreads, type ThreadSummary } from "@/lib/gmail";

/**
 * Recherche Gmail + sélection d'un thread. Réutilisé par la page /mail, le bloc
 * embed (P2) et la capture (P4). Suppose Gmail connecté (l'appelant masque le
 * picker sinon). Client ID réutilisé depuis googleDrive.clientId.
 */
export function EmailPicker({ onSelect }: { onSelect: (threadId: string) => void }) {
  const { settings } = useSettings();
  const clientId = settings.googleDrive.clientId.trim();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ThreadSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);

  const run = async () => {
    if (!query.trim()) return;
    setLoading(true);
    setError(null);
    try {
      setResults(await searchThreads(clientId, query.trim()));
      setSearched(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

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
        <div className="flex flex-col gap-1" role="listbox" aria-label="Résultats">
          {results.map((t) => (
            <Button
              key={t.id}
              variant="ghost"
              onPress={() => onSelect(t.id)}
              className="w-full justify-start text-left"
            >
              <span className="line-clamp-2 text-sm">{t.snippet || t.id}</span>
            </Button>
          ))}
        </div>
      )}

      {!loading && searched && results.length === 0 && !error && (
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>
          Aucun résultat.
        </p>
      )}
    </div>
  );
}
