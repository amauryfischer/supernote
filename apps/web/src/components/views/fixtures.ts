import type { ViewDefinition, ViewKind } from "@supernote/views";
import type { EntityType, Entity } from "@supernote/core";

// ---- Saved view fixtures --------------------------------------------------

export interface SavedView extends ViewDefinition {
  readonly entityTypeId: string;
  readonly resultCount: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

// Default: empty — the app starts with no saved views.
// Use demo-fixtures.ts for demo data.
export const SAVED_VIEWS: SavedView[] = [];

// ---- Entity type registry ------------------------------------------------

export const ENTITY_TYPES: Record<string, string> = {
  contact: "Contact",
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

// Default: empty — entities come from the vault/store.
export const MOCK_ENTITIES: Entity[] = [];
