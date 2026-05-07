export type SearchMode = "fts" | "semantic" | "hybrid";

export type FilterKey = "type" | "tag" | "in" | "relation" | "created" | "modified";

export interface ActiveFilter {
  key: FilterKey;
  value: string;
}

export interface SavedSearch {
  id: string;
  label: string;
  query: string;
  filters: ActiveFilter[];
  mode: SearchMode;
  savedAt: string;
}

export interface RecentSearch {
  id: string;
  query: string;
  usedAt: string;
}
