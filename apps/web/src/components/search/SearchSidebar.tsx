"use client";

import { useState } from "react";
import { Clock, BookmarkSimple, Trash, FloppyDisk, X } from "@phosphor-icons/react";
import { Button } from "@heroui/react";
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
          <Button
            variant="outline"
            size="sm"
            onPress={handleSave}
            className="sn-pressable w-full rounded-lg px-3 py-2 text-xs font-medium"
            style={{
              backgroundColor: showSaveConfirm ? "var(--accent-subtle)" : "var(--surface-1)",
              borderColor: showSaveConfirm ? "var(--accent)" : "var(--border-subtle)",
              color: showSaveConfirm ? "var(--accent)" : "var(--text-secondary)",
              transition: "var(--sn-transition-colors), var(--sn-transition-transform)",
            }}
          >
            <FloppyDisk size={13} />
            {showSaveConfirm ? "Sauvegardee !" : "Sauvegarder cette recherche"}
          </Button>
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
                <Button
                  variant="ghost"
                  size="sm"
                  onPress={() => onSelectQuery(r.query)}
                  className="sn-motion-colors flex-1 justify-start truncate rounded-md px-2 py-1 text-xs group-hover:bg-[var(--surface-2)] group-hover:text-[var(--text-primary)]"
                  style={{ color: "var(--text-secondary)" }}
                >
                  {r.query}
                </Button>
                <Button
                  isIconOnly
                  variant="ghost"
                  size="sm"
                  onPress={() => onDeleteRecent(r.id)}
                  aria-label="Supprimer cette recherche récente"
                  className="sn-reveal sn-hit shrink-0 rounded p-0.5"
                  style={{ color: "var(--text-muted)" }}
                >
                  <X size={10} />
                </Button>
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
                <Button
                  variant="ghost"
                  size="sm"
                  onPress={() => onLoadSaved(s)}
                  className="sn-motion-colors flex-1 justify-start truncate rounded-md px-2 py-1 group-hover:bg-[var(--surface-2)]"
                  style={{ color: "var(--text-secondary)" }}
                >
                  <span className="block truncate text-xs font-medium group-hover:text-[var(--text-primary)]">
                    {s.label}
                  </span>
                  <span className="block truncate font-mono text-[10px]" style={{ color: "var(--text-muted)" }}>
                    {s.query}
                  </span>
                </Button>
                <Button
                  isIconOnly
                  variant="ghost"
                  size="sm"
                  onPress={() => onDeleteSaved(s.id)}
                  aria-label="Supprimer cette recherche enregistrée"
                  className="sn-reveal sn-hit shrink-0 rounded p-0.5"
                  style={{ color: "var(--text-muted)" }}
                >
                  <Trash size={10} />
                </Button>
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
