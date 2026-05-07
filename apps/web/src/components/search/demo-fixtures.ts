/**
 * Demo fixtures for search — used by the "Charger des exemples (démo)" button in Settings > Backup.
 * These are NOT loaded by default. The app starts with an empty search.
 */
import type { SearchResult } from "@supernote/ipc";

export const DEMO_SEARCH_RESULTS: SearchResult[] = [
  {
    entityId: "entity-1",
    typeId: "note",
    typeName: "Note",
    filePath: "Notes/architecture-supernote.md",
    title: "Architecture Supernote",
    excerpts: ["Monorepo Turborepo. Pattern vault-first : toutes les données sont des fichiers."],
    score: 0.95,
    semantic: false,
    tags: ["dev", "architecture"],
  },
  {
    entityId: "entity-2",
    typeId: "personne",
    typeName: "Personne",
    filePath: "Contacts/alice-martin.md",
    title: "Alice Martin",
    excerpts: ["Responsable produit chez Acme. Spécialiste UX et design systems."],
    score: 0.88,
    semantic: true,
    tags: ["product", "ux"],
  },
  {
    entityId: "entity-3",
    typeId: "projet",
    typeName: "Projet",
    filePath: "Projets/supernote-pkm.md",
    title: "Supernote PKM",
    excerpts: ["Application de gestion de connaissances. MVP en cours."],
    score: 0.82,
    semantic: false,
    tags: ["dev", "produit"],
  },
];
