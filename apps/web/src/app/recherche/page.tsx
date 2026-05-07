"use client";

import { useMemo, useState } from "react";
import { AppShell } from "@/components/shell";
import { parseQuery } from "@supernote/search";
import { isOk } from "@supernote/core";
import {
  SearchBar,
  ModeToggle,
  FilterChips,
  ResultsGroup,
  EmptyState,
  SearchSidebar,
  AstPreview,
  FIXTURE_RESULTS,
  ENTITY_TYPE_LABELS,
  type SearchMode,
  type ActiveFilter,
  type SavedSearch,
  type RecentSearch,
} from "@/components/search";
import { useDebounce } from "@/hooks/useDebounce";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function groupByType(results: typeof FIXTURE_RESULTS): Map<string, typeof FIXTURE_RESULTS> {
  const groups = new Map<string, typeof FIXTURE_RESULTS>();
  for (const r of results) {
    const list = groups.get(r.typeId) ?? [];
    list.push(r);
    groups.set(r.typeId, list);
  }
  return groups;
}

function applyFilters(
  results: typeof FIXTURE_RESULTS,
  filters: ActiveFilter[],
): typeof FIXTURE_RESULTS {
  return results.filter((r) =>
    filters.every((f) => {
      switch (f.key) {
        case "type":
          return r.typeId === f.value;
        case "tag":
          return r.tags.includes(f.value);
        case "in":
          return r.filePath.startsWith(f.value);
        default:
          return true;
      }
    }),
  );
}

function applyQuery(
  results: typeof FIXTURE_RESULTS,
  query: string,
): typeof FIXTURE_RESULTS {
  const q = query.trim().toLowerCase();
  if (!q) return results;

  const ast = parseQuery(query);
  const freeWords = isOk(ast) ? ast.value.freeText.map((w) => w.toLowerCase()) : [q];
  const excluded = isOk(ast) ? ast.value.excluded.map((w) => w.toLowerCase()) : [];

  return results.filter((r) => {
    const haystack = `${r.title} ${r.excerpts.join(" ")} ${r.tags.join(" ")}`.toLowerCase();
    const hasWords = freeWords.length === 0 || freeWords.some((w) => haystack.includes(w));
    const hasExcluded = excluded.some((w) => haystack.includes(w));
    return hasWords && !hasExcluded;
  });
}

const TYPE_ORDER = ["note", "projet", "personne", "ressource", "journal"];

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function RecherchePage() {
  const [rawQuery, setRawQuery] = useState("");
  const [mode, setMode] = useState<SearchMode>("hybrid");
  const [filters, setFilters] = useState<ActiveFilter[]>([]);
  const [debugMode] = useState(false);
  const [recentSearches, setRecentSearches] = useState<RecentSearch[]>([
    { id: "r1", query: "type:personne tag:client", usedAt: "2026-05-07T09:00:00Z" },
    { id: "r2", query: "architecture monorepo", usedAt: "2026-05-06T17:00:00Z" },
    { id: "r3", query: "type:projet in:Projets", usedAt: "2026-05-05T11:00:00Z" },
  ]);
  const [savedSearches, setSavedSearches] = useState<SavedSearch[]>([
    {
      id: "s1",
      label: "Contacts clients",
      query: "type:personne tag:client",
      filters: [],
      mode: "hybrid",
      savedAt: "2026-05-01T10:00:00Z",
    },
  ]);

  const debouncedQuery = useDebounce(rawQuery, 250);

  const ast = useMemo(() => {
    if (!debouncedQuery.trim()) return null;
    const result = parseQuery(debouncedQuery);
    return isOk(result) ? result.value : null;
  }, [debouncedQuery]);

  // Extract filter chips from AST when query changes
  const combinedFilters = useMemo((): ActiveFilter[] => {
    if (!ast) return filters;
    const validKeys = new Set<string>(["type", "tag", "in", "relation", "created", "modified"]);
    const astFilters: ActiveFilter[] = ast.filters
      .filter((f) => validKeys.has(f.key))
      .map((f) => ({ key: f.key as ActiveFilter["key"], value: f.value }))
      .filter((af) => !filters.some((ef) => ef.key === af.key && ef.value === af.value));
    return [...filters, ...astFilters];
  }, [ast, filters]);

  const filteredResults = useMemo(() => {
    let results = FIXTURE_RESULTS;
    results = applyQuery(results, debouncedQuery);
    results = applyFilters(results, combinedFilters);

    // Mode affects ordering simulation
    if (mode === "semantic") {
      results = [...results].sort((a, b) => (b.semantic ? 1 : 0) - (a.semantic ? 1 : 0));
    } else if (mode === "fts") {
      results = [...results].filter((r) => !r.semantic || Math.random() > 0.5);
    }

    return results;
  }, [debouncedQuery, combinedFilters, mode]);

  const grouped = useMemo(() => groupByType(filteredResults), [filteredResults]);

  const handleQueryChange = (value: string) => {
    setRawQuery(value);
    if (value.trim()) {
      setRecentSearches((prev) => {
        const filtered = prev.filter((r) => r.query !== value);
        return [{ id: `r-${Date.now()}`, query: value, usedAt: new Date().toISOString() }, ...filtered].slice(0, 20);
      });
    }
  };

  const handleExampleClick = (example: string) => {
    setRawQuery(example);
  };

  const handleAddFilter = (filter: ActiveFilter) => {
    setFilters((prev) => [...prev, filter]);
  };

  const handleRemoveFilter = (index: number) => {
    setFilters((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSave = () => {
    const label = rawQuery.trim() || "Recherche sans titre";
    setSavedSearches((prev) => [
      {
        id: `s-${Date.now()}`,
        label,
        query: rawQuery,
        filters,
        mode,
        savedAt: new Date().toISOString(),
      },
      ...prev,
    ]);
  };

  const handleLoadSaved = (saved: SavedSearch) => {
    setRawQuery(saved.query);
    setFilters(saved.filters);
    setMode(saved.mode);
  };

  const handleDeleteSaved = (id: string) => {
    setSavedSearches((prev) => prev.filter((s) => s.id !== id));
  };

  const handleDeleteRecent = (id: string) => {
    setRecentSearches((prev) => prev.filter((r) => r.id !== id));
  };

  const hasResults = filteredResults.length > 0;
  const isSearching = debouncedQuery.trim().length > 0 || combinedFilters.length > 0;

  const orderedTypeIds = TYPE_ORDER.filter((t) => grouped.has(t)).concat(
    [...grouped.keys()].filter((t) => !TYPE_ORDER.includes(t)),
  );

  return (
    <AppShell>
      <div className="flex h-full">
        {/* Left sidebar */}
        <div
          className="hidden w-56 shrink-0 border-r p-4 lg:block"
          style={{ borderColor: "var(--border-subtle)" }}
        >
          <SearchSidebar
            recentSearches={recentSearches}
            savedSearches={savedSearches}
            query={rawQuery}
            filters={filters}
            mode={mode}
            onSelectQuery={handleQueryChange}
            onDeleteRecent={handleDeleteRecent}
            onSave={handleSave}
            onLoadSaved={handleLoadSaved}
            onDeleteSaved={handleDeleteSaved}
          />
        </div>

        {/* Main content */}
        <div className="flex flex-1 flex-col overflow-hidden">
          {/* Search header */}
          <div
            className="border-b px-6 py-4"
            style={{ borderColor: "var(--border-subtle)" }}
          >
            <SearchBar
              value={rawQuery}
              onChange={handleQueryChange}
            />

            <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
              <FilterChips
                filters={filters}
                onAdd={handleAddFilter}
                onRemove={handleRemoveFilter}
              />
              <ModeToggle mode={mode} onChange={setMode} />
            </div>

            {ast && debugMode && (
              <div className="mt-2">
                <AstPreview ast={ast} />
              </div>
            )}

            {isSearching && hasResults && (
              <p className="mt-2 text-xs" style={{ color: "var(--text-muted)" }}>
                {filteredResults.length} resultat{filteredResults.length > 1 ? "s" : ""}
                {combinedFilters.length > 0 ? ` (${combinedFilters.length} filtre${combinedFilters.length > 1 ? "s" : ""})` : ""}
              </p>
            )}
          </div>

          {/* Results */}
          <div className="flex-1 overflow-y-auto px-6 py-4">
            {!isSearching || !hasResults ? (
              <EmptyState query={rawQuery} onExampleClick={handleExampleClick} />
            ) : (
              <div className="flex flex-col gap-6 pb-8">
                {orderedTypeIds.map((typeId) => {
                  const results = grouped.get(typeId);
                  if (!results) return null;
                  return (
                    <ResultsGroup
                      key={typeId}
                      typeId={typeId}
                      results={results}
                      query={debouncedQuery}
                      debugMode={debugMode}
                    />
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
