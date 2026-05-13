"use client";

/**
 * EntityLinkPicker — modal picker used by NoteCanvasView's "+ Lier une
 * entité" button.
 *
 * Why not reuse @supernote/editor's EntityPicker?
 *   That picker is wired up for an inline-popover use case inside the
 *   BlockNote editor and depends on a `resolvers` bag with createEntity /
 *   getEntity etc. Here we just need a centered modal with a search box
 *   and an arrow-key-navigable result list — borrowing the heavier
 *   component would drag editor concerns into the canvas surface.
 */

import { useCallback, useEffect, useRef, useState } from "react";

interface EntityHit {
  id: string;
  name: string;
  typeId: string;
  typeName: string;
}

interface EntityLinkPickerProps {
  search: (query: string, typeFilter?: string) => Promise<EntityHit[]>;
  /**
   * When set, narrows the autocomplete to a single entity-type id (e.g.
   * "personne", "note") — the picker becomes a typed picker. Used by the
   * canvas toolbar's "Lier une note", "Lier un contact", etc. buttons so
   * the search hits stay focused on the requested type.
   */
  typeFilter?: string;
  onSelect: (entityId: string) => void;
  onClose: () => void;
}

/** Display labels for the typed picker's header. Mirrors the typed-button
 * labels in DrawLayer; kept in lockstep so the user sees consistent wording
 * between toolbar and modal. */
const TYPE_FILTER_LABELS: Record<string, string> = {
  note: "Lier une note",
  personne: "Lier un contact",
  organisation: "Lier une organisation",
  interaction: "Lier une interaction",
  asset: "Lier un actif",
  account: "Lier un compte",
  goal: "Lier un objectif",
  loan: "Lier un prêt",
  canvas: "Lier un canvas",
};

export function EntityLinkPicker({
  search,
  typeFilter,
  onSelect,
  onClose,
}: EntityLinkPickerProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<EntityHit[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Debounce the search 200ms — typing 'amaury' should not fire 6 RPCs.
  // When `typeFilter` is set, an empty query is allowed (the worker returns
  // the most-recent entities of that type); without a filter we still need
  // a non-empty query because the IPC schema enforces `query.min(1)`.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const timer = setTimeout(() => {
      search(query, typeFilter)
        .then((res) => {
          if (cancelled) return;
          setResults(res);
          setSelectedIndex(0);
        })
        .catch(() => {
          if (!cancelled) setResults([]);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, search, typeFilter]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, Math.max(results.length - 1, 0)));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        const picked = results[selectedIndex];
        if (picked) onSelect(picked.id);
      }
    },
    [results, selectedIndex, onSelect, onClose],
  );

  const headerLabel = typeFilter
    ? (TYPE_FILTER_LABELS[typeFilter] ?? "Lier une entité")
    : "Lier une entité";

  return (
    <div
      onMouseDown={onClose}
      className="fixed inset-0 z-50 flex items-start justify-center pt-24"
      style={{ backgroundColor: "rgba(15, 23, 42, 0.45)" }}
      role="dialog"
      aria-label={headerLabel}
    >
      <div
        onMouseDown={(e) => e.stopPropagation()}
        className="w-[480px] max-w-[92vw] rounded-lg shadow-xl"
        style={{
          backgroundColor: "var(--surface-0, #fff)",
          border: "1px solid var(--border-subtle, #e2e8f0)",
        }}
      >
        {typeFilter && (
          <div
            className="px-4 py-2 text-xs font-medium"
            style={{
              color: "var(--text-muted)",
              borderBottom: "1px solid var(--border-subtle)",
            }}
          >
            {headerLabel}
          </div>
        )}
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={
            typeFilter
              ? "Rechercher (ou laisser vide pour les récents)…"
              : "Rechercher une entité…"
          }
          className="w-full bg-transparent px-4 py-3 text-sm outline-none"
          style={{
            color: "var(--text-primary)",
            borderBottom: "1px solid var(--border-subtle)",
          }}
          aria-autocomplete="list"
        />

        <ul
          className="max-h-80 overflow-y-auto py-1"
          role="listbox"
          aria-label="Résultats"
        >
          {loading && (
            <li
              className="px-4 py-2 text-xs"
              style={{ color: "var(--text-muted)" }}
            >
              Recherche…
            </li>
          )}
          {!loading && results.length === 0 && (
            <li
              className="px-4 py-2 text-xs"
              style={{ color: "var(--text-muted)" }}
            >
              Aucun résultat
            </li>
          )}
          {results.map((hit, i) => (
            <li
              key={hit.id}
              role="option"
              aria-selected={i === selectedIndex}
              onMouseEnter={() => setSelectedIndex(i)}
              onMouseDown={(e) => {
                e.preventDefault();
                onSelect(hit.id);
              }}
              className="flex cursor-pointer items-center justify-between px-4 py-2 text-sm"
              style={{
                backgroundColor:
                  i === selectedIndex
                    ? "var(--surface-2, #f1f5f9)"
                    : "transparent",
                color: "var(--text-primary)",
              }}
            >
              <span className="truncate">{hit.name}</span>
              <span
                className="ml-3 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium"
                style={{
                  backgroundColor: "var(--accent-subtle, #ede9fe)",
                  color: "var(--accent, #7c3aed)",
                }}
              >
                {hit.typeName}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
