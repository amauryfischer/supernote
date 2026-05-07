/**
 * Demo fixtures for canvas — used by the "Charger des exemples (démo)" button in Settings > Backup.
 * These are NOT loaded by default. The app starts empty.
 */
import type { CanvasMeta } from "./fixtures";

export const DEMO_CANVAS_LIST: CanvasMeta[] = [
  {
    id: "c1",
    title: "Architecture Supernote",
    updatedAt: "2026-05-07T10:00:00Z",
    nodeCount: 12,
    edgeCount: 8,
    tags: ["dev", "architecture"],
  },
  {
    id: "c2",
    title: "Roadmap Produit",
    updatedAt: "2026-05-06T16:30:00Z",
    nodeCount: 7,
    edgeCount: 4,
    tags: ["produit"],
  },
  {
    id: "c3",
    title: "Brainstorm : PKM features",
    updatedAt: "2026-05-03T09:30:00Z",
    nodeCount: 24,
    edgeCount: 14,
    tags: ["idées", "produit"],
  },
];
