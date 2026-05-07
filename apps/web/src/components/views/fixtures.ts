import type { ViewDefinition, ViewKind } from "@supernote/views";
import type { EntityType, Entity } from "@supernote/core";

// ---- Saved view fixtures --------------------------------------------------

export interface SavedView extends ViewDefinition {
  readonly entityTypeId: string;
  readonly resultCount: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export const SAVED_VIEWS: SavedView[] = [
  {
    id: "view-001",
    name: "Contacts clients",
    kind: "table",
    entityTypeId: "contact",
    resultCount: 142,
    filters: [{ fieldId: "relationType", operator: "eq", value: "client" }],
    sort: [{ fieldId: "name", direction: "asc" }],
    createdAt: "2026-01-10T09:00:00Z",
    updatedAt: "2026-04-20T14:30:00Z",
  },
  {
    id: "view-002",
    name: "Projets actifs",
    kind: "kanban",
    entityTypeId: "project",
    resultCount: 27,
    filters: [{ fieldId: "status", operator: "neq", value: "archived" }],
    groupBy: "status",
    createdAt: "2026-01-15T10:00:00Z",
    updatedAt: "2026-04-25T11:00:00Z",
  },
  {
    id: "view-003",
    name: "Interactions semaine",
    kind: "calendar",
    entityTypeId: "interaction",
    resultCount: 18,
    dateField: "date",
    sort: [{ fieldId: "date", direction: "asc" }],
    createdAt: "2026-02-01T08:00:00Z",
    updatedAt: "2026-05-01T09:00:00Z",
  },
  {
    id: "view-004",
    name: "Galerie actifs",
    kind: "gallery",
    entityTypeId: "asset",
    resultCount: 64,
    cardConfig: { titleFieldId: "name", coverImageFieldId: "image", colCount: 4 },
    createdAt: "2026-02-10T12:00:00Z",
    updatedAt: "2026-04-15T16:00:00Z",
  },
  {
    id: "view-005",
    name: "Timeline prêts",
    kind: "timeline",
    entityTypeId: "loan",
    resultCount: 12,
    dateField: "startDate",
    endDateField: "endDate",
    sort: [{ fieldId: "startDate", direction: "asc" }],
    createdAt: "2026-02-20T10:00:00Z",
    updatedAt: "2026-04-30T14:00:00Z",
  },
  {
    id: "view-006",
    name: "Graphe relations",
    kind: "graph",
    entityTypeId: "contact",
    resultCount: 89,
    graphConfig: { nodeLabelFieldId: "name", showRelationLabels: true },
    createdAt: "2026-03-01T09:00:00Z",
    updatedAt: "2026-05-01T10:00:00Z",
  },
  {
    id: "view-007",
    name: "Notes par projet",
    kind: "table",
    entityTypeId: "note",
    resultCount: 234,
    filters: [{ fieldId: "projectId", operator: "isNotEmpty", value: undefined }],
    sort: [{ fieldId: "updatedAt", direction: "desc" }],
    createdAt: "2026-03-10T11:00:00Z",
    updatedAt: "2026-05-02T09:00:00Z",
  },
  {
    id: "view-008",
    name: "Taches en retard",
    kind: "kanban",
    entityTypeId: "task",
    resultCount: 8,
    filters: [
      { fieldId: "dueDate", operator: "lt", value: new Date().toISOString().split("T")[0] },
      { fieldId: "status", operator: "neq", value: "done" },
    ],
    groupBy: "assignee",
    createdAt: "2026-03-15T08:00:00Z",
    updatedAt: "2026-05-06T17:00:00Z",
  },
];

// ---- Entity type registry ------------------------------------------------

export const ENTITY_TYPES: Record<string, string> = {
  contact: "Contact",
  project: "Projet",
  interaction: "Interaction",
  asset: "Actif",
  loan: "Pret",
  note: "Note",
  task: "Tache",
};

// ---- Mock EntityType schema for preview ----------------------------------

export const MOCK_SCHEMA: EntityType = {
  id: "contact",
  name: "Contact",
  plural: "Contacts",
  icon: "person",
  defaultPath: "contacts",
  fileNamePattern: "{name}",
  fields: [
    {
      id: "name",
      name: "name",
      label: "Nom",
      kind: "text",
      required: true,
      unique: false,
    },
    {
      id: "email",
      name: "email",
      label: "Email",
      kind: "email",
      required: false,
      unique: false,
    },
    {
      id: "status",
      name: "status",
      label: "Statut",
      kind: "select",
      required: false,
      unique: false,
      options: [
        { value: "actif", label: "Actif", color: "#22c55e" },
        { value: "inactif", label: "Inactif", color: "#94a3b8" },
        { value: "prospect", label: "Prospect", color: "#3b82f6" },
      ],
    },
    {
      id: "company",
      name: "company",
      label: "Societe",
      kind: "text",
      required: false,
      unique: false,
    },
    {
      id: "createdAt",
      name: "createdAt",
      label: "Cree le",
      kind: "createdAt",
      required: false,
      unique: false,
    },
  ],
};

// ---- Mock entities for preview -------------------------------------------

export const MOCK_ENTITIES: Entity[] = [
  {
    id: "e-001",
    typeId: "contact",
    filePath: "contacts/alice-martin.md",
    fields: { name: "Alice Martin", email: "alice@example.com", status: "actif", company: "Numerisk" },
    body: "",
    createdAt: new Date("2026-01-05"),
    updatedAt: new Date("2026-04-20"),
    tags: ["client", "tech"],
  },
  {
    id: "e-002",
    typeId: "contact",
    filePath: "contacts/bob-dupont.md",
    fields: { name: "Bob Dupont", email: "bob@dupont.fr", status: "prospect", company: "Acme" },
    body: "",
    createdAt: new Date("2026-01-10"),
    updatedAt: new Date("2026-03-15"),
    tags: ["prospect"],
  },
  {
    id: "e-003",
    typeId: "contact",
    filePath: "contacts/claire-leroy.md",
    fields: { name: "Claire Leroy", email: "claire@leroy.io", status: "actif", company: "Leroy & Co" },
    body: "",
    createdAt: new Date("2026-02-01"),
    updatedAt: new Date("2026-05-01"),
    tags: ["client"],
  },
  {
    id: "e-004",
    typeId: "contact",
    filePath: "contacts/david-moreau.md",
    fields: { name: "David Moreau", email: "david@moreau.fr", status: "inactif", company: "" },
    body: "",
    createdAt: new Date("2025-11-20"),
    updatedAt: new Date("2026-01-10"),
    tags: [],
  },
  {
    id: "e-005",
    typeId: "contact",
    filePath: "contacts/emma-blanc.md",
    fields: { name: "Emma Blanc", email: "emma@blanc.com", status: "actif", company: "BlancTech" },
    body: "",
    createdAt: new Date("2026-03-01"),
    updatedAt: new Date("2026-05-05"),
    tags: ["client", "partenaire"],
  },
];
