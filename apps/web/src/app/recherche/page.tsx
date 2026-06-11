"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AppShell,
  useMobileTitle,
  useMobileHeaderActions,
  type MobileHeaderAction,
} from "@/components/shell";
import { useIsMobile } from "@/hooks/useIsMobile";
import { parseQuery } from "@supernote/search/query";
import { isOk } from "@supernote/core";
import type { SearchResult } from "@supernote/ipc";
import {
  SearchBar,
  ModeToggle,
  FilterChips,
  ResultsGroup,
  EmptyState,
  SearchSidebar,
  AstPreview,
  type SearchMode,
  type ActiveFilter,
  type SavedSearch,
  type RecentSearch,
} from "@/components/search";
import { MagnifyingGlass } from "@phosphor-icons/react";
import { useDebounce } from "@/hooks/useDebounce";
import { trpc, hasWorkerBackend } from "@/lib/trpc/client";
import { isWorkerReady } from "@/lib/trpc/browser-link";
import {
  loadSavedSearches,
  saveSavedSearches,
  loadRecentSearches,
  saveRecentSearches,
} from "@/components/search/storage";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function groupByType(results: SearchResult[]): Map<string, SearchResult[]> {
  const groups = new Map<string, SearchResult[]>();
  for (const r of results) {
    const list = groups.get(r.typeId) ?? [];
    list.push(r);
    groups.set(r.typeId, list);
  }
  return groups;
}

/**
 * Client-side filter pass for chips that the worker doesn't (yet) support
 * natively. `type:` is forwarded to the worker as `typeId`; `tag:` and
 * `in:` (folder prefix) are applied here on the returned items.
 *
 * Excluded terms parsed from the query AST are also stripped client-side —
 * MiniSearch doesn't expose a NOT operator, so we post-filter the result
 * set against the title + excerpts haystack. Imperfect (won't catch terms
 * that only appear in the body outside the excerpt window) but close
 * enough for the in-list NOT semantics users expect.
 */
function applyClientFilters(
  results: SearchResult[],
  filters: ActiveFilter[],
  excluded: string[],
): SearchResult[] {
  return results.filter((r) => {
    for (const f of filters) {
      if (f.key === "tag" && !r.tags.includes(f.value)) return false;
      if (f.key === "in" && !r.filePath.startsWith(f.value)) return false;
    }
    if (excluded.length > 0) {
      const haystack = `${r.title} ${r.excerpts.join(" ")} ${r.tags.join(" ")}`.toLowerCase();
      if (excluded.some((w) => haystack.includes(w))) return false;
    }
    return true;
  });
}

const TYPE_ORDER = ["note", "personne", "ressource", "journal"];

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function RecherchePage() {
  const isMobile = useIsMobile();
  const [rawQuery, setRawQuery] = useState("");
  const [mode, setMode] = useState<SearchMode>("hybrid");
  const [filters, setFilters] = useState<ActiveFilter[]>([]);
  const [debugMode] = useState(false);
  // Saved + recent searches are persisted in localStorage (see
  // components/search/storage.ts). Lazy initializers read the durable store
  // once on mount; every mutation below writes back through the setters.
  const [recentSearches, setRecentSearches] = useState<RecentSearch[]>(loadRecentSearches);
  const [savedSearches, setSavedSearches] = useState<SavedSearch[]>(loadSavedSearches);

  // Persist back to localStorage whenever the lists change. Keeping the write
  // in an effect (rather than inside each handler) means a single source of
  // truth for persistence and survives any future mutation path.
  useEffect(() => {
    saveRecentSearches(recentSearches);
  }, [recentSearches]);
  useEffect(() => {
    saveSavedSearches(savedSearches);
  }, [savedSearches]);

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

  // Strip filter syntax (type:foo, tag:bar, …) and excluded terms from the
  // raw query before sending it to the worker. The worker's MiniSearch
  // doesn't understand the query DSL — passing "type:personne leroy"
  // verbatim makes it tokenize "type:personne" as a single garbage term.
  // Excluded terms are post-filtered client-side instead (see
  // applyClientFilters) since MiniSearch has no NOT operator.
  const workerQuery = useMemo(() => {
    if (!ast) return debouncedQuery.trim();
    return ast.freeText.join(" ").trim();
  }, [ast, debouncedQuery]);

  const excludedTerms = useMemo(
    () => (ast?.excluded ?? []).map((w) => w.toLowerCase()),
    [ast],
  );

  // typeFilter forwarded to the worker (it can index by typeId in O(1));
  // we keep it in combinedFilters for the chip UI but strip it from the
  // client-side filter pass so we don't double-filter.
  const typeFilter = useMemo(
    () => combinedFilters.find((f) => f.key === "type")?.value,
    [combinedFilters],
  );

  // Worker readiness gate — same pattern as useNoteList. Listens for the
  // VAULT_READY event so the search query re-enables the moment the worker
  // is up, instead of getting stuck in `error: "Vault not initialized"`.
  const [workerReady, setWorkerReady] = useState(() =>
    typeof window === "undefined" ? false : isWorkerReady(),
  );
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (isWorkerReady()) setWorkerReady(true);
    const onReady = () => setWorkerReady(true);
    window.addEventListener("supernote:vault-ready", onReady);
    return () => window.removeEventListener("supernote:vault-ready", onReady);
  }, []);

  const hasBackend = hasWorkerBackend();
  const canQuery = hasBackend && workerReady && workerQuery.length > 0;

  // The worker route returns rich SearchResult[] items already shaped for
  // the UI. Mode toggle (`fts`/`semantic`/`hybrid`) is wired to the same
  // endpoint for now — semantic + hybrid stubs return empty in the worker,
  // so falling back to `search.query` keeps the UI usable until they land.
  const searchQuery = trpc.search.query.useQuery(
    {
      query: workerQuery,
      typeId: typeFilter,
      limit: 100,
      offset: 0,
    },
    {
      enabled: canQuery,
      retry: false,
      staleTime: 30_000,
    },
  );

  const filteredResults = useMemo<SearchResult[]>(() => {
    if (!canQuery) return [];
    const items = (searchQuery.data?.items ?? []) as SearchResult[];
    return applyClientFilters(items, combinedFilters, excludedTerms);
  }, [canQuery, searchQuery.data, combinedFilters, excludedTerms]);

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
  const isLoading = canQuery && (searchQuery.isLoading || searchQuery.isFetching) && !searchQuery.data;

  const orderedTypeIds = TYPE_ORDER.filter((t) => grouped.has(t)).concat(
    [...grouped.keys()].filter((t) => !TYPE_ORDER.includes(t)),
  );

  useMobileTitle(isMobile ? "Recherche" : null);

  const mobileHeaderActions = useMemo((): MobileHeaderAction[] => {
    if (!isMobile) return [];
    return [
      {
        id: "search-focus",
        icon: MagnifyingGlass,
        label: "Rechercher",
        onPress: () => {
          const el = document.querySelector<HTMLInputElement>("[data-search-input]");
          el?.focus();
        },
      },
    ];
  }, [isMobile]);

  useMobileHeaderActions(mobileHeaderActions);

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
            className="border-b px-3 py-3 md:px-6 md:py-4"
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
              {/* ModeToggle hidden on mobile — not critical in narrow view */}
              <div className="hidden md:block">
                <ModeToggle mode={mode} onChange={setMode} />
              </div>
            </div>

            {ast && debugMode && (
              <div className="mt-2">
                <AstPreview ast={ast} />
              </div>
            )}

            {isSearching && (isLoading || hasResults) && (
              <p className="mt-2 text-xs" style={{ color: "var(--text-muted)" }}>
                {isLoading
                  ? "Recherche…"
                  : `${filteredResults.length} résultat${filteredResults.length > 1 ? "s" : ""}`}
                {!isLoading && combinedFilters.length > 0
                  ? ` (${combinedFilters.length} filtre${combinedFilters.length > 1 ? "s" : ""})`
                  : ""}
                {searchQuery.data?.durationMs !== undefined && !isLoading
                  ? ` · ${searchQuery.data.durationMs} ms`
                  : ""}
              </p>
            )}
            {isSearching && !hasBackend && (
              <p className="mt-2 text-xs" style={{ color: "var(--text-muted)" }}>
                Recherche indisponible en mode dégradé (FSA non supporté).
              </p>
            )}
          </div>

          {/* Results */}
          <div className="flex-1 overflow-y-auto px-3 py-3 md:px-6 md:py-4">
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
