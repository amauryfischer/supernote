// EntityPicker — inline autocomplete popover for entity search
// Opened by slash menu items; calls resolvers.searchEntities and inserts a pill

import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import type { EntityRef, EntityResolvers } from "../types.js";

export interface EntityPickerProps {
  /** Which entity type to filter (e.g. "note", "personne", "projet") */
  typeId: string;
  /** Human-readable label used in the "+ Creer" row */
  typeLabel: string;
  /** Resolver bag from SupernoteEditorProps */
  resolvers: EntityResolvers | undefined;
  /** Called when the user selects or creates an entity */
  onSelect: (entity: EntityRef) => void;
  /** Called when the picker should close without selecting */
  onClose: () => void;
}

const FALLBACK_MESSAGE =
  "Connecte-toi a un vault pour rechercher des entites.";

/** Keyboard-navigable entity search popover */
export function EntityPicker({
  typeId,
  typeLabel,
  resolvers,
  onSelect,
  onClose,
}: EntityPickerProps): React.JSX.Element {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<EntityRef[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  // Auto-focus on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Search when query changes
  useEffect(() => {
    if (!resolvers) return;
    setLoading(true);
    let cancelled = false;
    resolvers
      .searchEntities(query, typeId)
      .then((res) => {
        if (!cancelled) {
          setResults(res.slice(0, 8));
          setSelectedIndex(0);
        }
      })
      .catch(() => {
        if (!cancelled) setResults([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [query, typeId, resolvers]);

  // Scroll selected item into view
  useEffect(() => {
    const item = listRef.current?.children[selectedIndex] as
      | HTMLElement
      | undefined;
    item?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  const confirm = useCallback(
    (entity: EntityRef) => {
      onSelect(entity);
      onClose();
    },
    [onSelect, onClose]
  );

  const handleCreateNew = useCallback(async () => {
    if (!resolvers?.createEntity) return;
    try {
      const entity = await resolvers.createEntity(typeId, query.trim());
      confirm(entity);
    } catch {
      // swallow — surface could add toast later
    }
  }, [resolvers, typeId, query, confirm]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, results.length - 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        const selected = results[selectedIndex];
        if (selected) confirm(selected);
        else if (query.trim() && resolvers?.createEntity) handleCreateNew();
        return;
      }
    },
    [results, selectedIndex, query, resolvers, confirm, handleCreateNew, onClose]
  );

  const showCreate =
    query.trim().length > 0 &&
    resolvers?.createEntity !== undefined &&
    results.length === 0 &&
    !loading;

  return (
    <div
      className="sn-entity-picker"
      role="dialog"
      aria-label={`Choisir ${typeLabel}`}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <input
        ref={inputRef}
        className="sn-entity-picker__input"
        type="text"
        placeholder={`Rechercher ${typeLabel}…`}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={handleKeyDown}
        aria-autocomplete="list"
        aria-controls="entity-picker-list"
        autoComplete="off"
      />

      {!resolvers && (
        <div className="sn-entity-picker__fallback">{FALLBACK_MESSAGE}</div>
      )}

      {resolvers && (
        <>
          <ul
            id="entity-picker-list"
            ref={listRef}
            className="sn-entity-picker__list"
            role="listbox"
            aria-label={`Resultats ${typeLabel}`}
          >
            {loading && (
              <li className="sn-entity-picker__loader" aria-live="polite">
                Chargement…
              </li>
            )}
            {!loading && results.length === 0 && !showCreate && (
              <li className="sn-entity-picker__empty">Aucun resultat</li>
            )}
            {results.map((entity, i) => (
              <li
                key={entity.id}
                role="option"
                aria-selected={i === selectedIndex}
                className={`sn-entity-picker__item${
                  i === selectedIndex ? " sn-entity-picker__item--selected" : ""
                }`}
                onMouseEnter={() => setSelectedIndex(i)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  confirm(entity);
                }}
              >
                {entity.icon && (
                  <span className="sn-entity-picker__item-icon" aria-hidden="true">
                    {entity.icon}
                  </span>
                )}
                <span className="sn-entity-picker__item-name">{entity.name}</span>
              </li>
            ))}
          </ul>

          {showCreate && (
            <button
              className="sn-entity-picker__create"
              onMouseDown={(e) => {
                e.preventDefault();
                void handleCreateNew();
              }}
              type="button"
            >
              + Creer {typeLabel} &quot;{query.trim()}&quot;
            </button>
          )}
        </>
      )}
    </div>
  );
}
