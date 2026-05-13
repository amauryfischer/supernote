import type { SearchResult } from "@supernote/ipc";

// Default: empty — search results come from the vault/store.
// Use demo-fixtures.ts for demo data.
export const FIXTURE_RESULTS: SearchResult[] = [];

export const ENTITY_TYPE_LABELS: Record<string, string> = {
  note: "Notes",
  personne: "Personnes",
  ressource: "Ressources",
  journal: "Journal",
};
