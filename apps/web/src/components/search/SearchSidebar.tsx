"use client";

import { useState } from "react";
import { Clock, BookmarkSimple, Trash, FloppyDisk, X } from "@phosphor-icons/react";
import type { RecentSearch, SavedSearch, SearchMode, ActiveFilter } from "./types";

interface SearchSidebarProps {
  recentSearches: RecentSearch[];
  savedSearches: SavedSearch[];
  query: string;
  filters: ActiveFilter[];
  mode: SearchMode;
  onSelectQuery: (query: string) => void;
  onDeleteRecent: (id: string) => void;
  onSave: () => void;
  onLoadSaved: (saved: SavedSearch) => void;
  onDeleteSaved: (id: string) => void;
}

export function SearchSidebar({
  recentSearches,
  savedSearches,
  query,
  onSelectQuery,
  onDeleteRecent,
  onSave,
  onLoadSaved,
  onDeleteSaved,
}: SearchSidebarProps) {
  const [showSaveConfirm, setShowSaveConfirm] = useState(false);

  const handleSave = () => {
    onSave();
    setShowSaveConfirm(true);
    setTimeout(() => setShowSaveConfirm(false), 1500);
  };

  return (
    <aside className="flex h-full flex-col gap-6">
      {query.trim() && (
        <div>
          <button
            onClick={handleSave}
            className="flex w-full items-center justify-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium transition-colors"
            style={{
              backgroundColor: showSaveConfirm ? "var(--accent-subtle)" : "var(--surface-1)",
              borderColor: showSaveConfirm ? "var(--accent)" : "var(--border-subtle)",
              color: showSaveConfirm ? "var(--accent)" : "var(--text-secondary)",
            }}
          >
            <FloppyDisk size={13} />
            {showSaveConfirm ? "Sauvegardee !" : "Sauvegarder cette recherche"}
          </button>
        </div>
      )}

      {recentSearches.length > 0 && (
        <section>
          <h3
            className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider"
            style={{ color: "var(--text-muted)" }}
          >
            <Clock size={11} />
            Recentes
          </h3>
          <ul className="flex flex-col gap-0.5">
            {recentSearches.slice(0, 8).map((r) => (
              <li key={r.id} className="group flex items-center gap-1">
                <button
                  onClick={() => onSelectQuery(r.query)}
                  className="flex-1 truncate rounded-md px-2 py-1 text-left text-xs transition-colors hover:opacity-70"
                  style={{ color: "var(--text-secondary)" }}
                >
                  {r.query}
                </button>
                <button
                  onClick={() => onDeleteRecent(r.id)}
                  className="shrink-0 rounded p-0.5 opacity-0 transition-opacity group-hover:opacity-100"
                  style={{ color: "var(--text-muted)" }}
                >
                  <X size={10} />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {savedSearches.length > 0 && (
        <section>
          <h3
            className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider"
            style={{ color: "var(--text-muted)" }}
          >
            <BookmarkSimple size={11} />
            Sauvegardees
          </h3>
          <ul className="flex flex-col gap-0.5">
            {savedSearches.map((s) => (
              <li key={s.id} className="group flex items-center gap-1">
                <button
                  onClick={() => onLoadSaved(s)}
                  className="flex-1 truncate rounded-md px-2 py-1 text-left transition-colors hover:opacity-70"
                  style={{ color: "var(--text-secondary)" }}
                >
                  <span className="block truncate text-xs font-medium">{s.label}</span>
                  <span className="block truncate font-mono text-[10px]" style={{ color: "var(--text-muted)" }}>
                    {s.query}
                  </span>
                </button>
                <button
                  onClick={() => onDeleteSaved(s.id)}
                  className="shrink-0 rounded p-0.5 opacity-0 transition-opacity group-hover:opacity-100"
                  style={{ color: "var(--text-muted)" }}
                >
                  <Trash size={10} />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {recentSearches.length === 0 && savedSearches.length === 0 && (
        <div className="text-xs" style={{ color: "var(--text-muted)" }}>
          Vos recherches apparaitront ici.
        </div>
      )}
    </aside>
  );
}
