/**
 * Demo fixtures for views — used by the "Charger des exemples (démo)" button in Settings > Backup.
 * These are NOT loaded by default. The app starts empty.
 */
import type { SavedView } from "./fixtures";

export const DEMO_SAVED_VIEWS: SavedView[] = [
  {
    id: "view-001",
    name: "Contacts clients",
    kind: "table",
    entityTypeId: "contact",
    resultCount: 0,
    filters: [{ fieldId: "relationType", operator: "eq", value: "client" }],
    sort: [{ fieldId: "name", direction: "asc" }],
    createdAt: "2026-01-10T09:00:00Z",
    updatedAt: "2026-04-20T14:30:00Z",
  },
  {
    id: "view-003",
    name: "Interactions semaine",
    kind: "calendar",
    entityTypeId: "interaction",
    resultCount: 0,
    dateField: "date",
    sort: [{ fieldId: "date", direction: "asc" }],
    createdAt: "2026-02-01T08:00:00Z",
    updatedAt: "2026-05-01T09:00:00Z",
  },
];
