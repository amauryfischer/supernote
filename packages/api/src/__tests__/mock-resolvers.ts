import type { Resolvers, CreateEntityInput, UpdateEntityInput, CreateRelationInput, ListEntitiesFilter, SearchOptions } from "../types.js";
import type { Entity, EntityType, RelationEdge, Tag, RelationType, FieldValue } from "@supernote/core";

export const MOCK_ENTITY: Entity = {
  id: "01JTEST000000001",
  typeId: "contact",
  filePath: "/vault/contacts/alice.md",
  fields: { name: "Alice", email: "alice@example.com" },
  body: "# Alice\n\nA test contact.",
  createdAt: new Date("2024-01-01T00:00:00Z"),
  updatedAt: new Date("2024-01-01T00:00:00Z"),
  tags: ["client"],
};

export const MOCK_ENTITY_TYPE: EntityType = {
  id: "contact",
  name: "Contact",
  plural: "Contacts",
  fields: [
    { id: "name", name: "name", label: "Name", kind: "text", required: true, unique: false },
    { id: "email", name: "email", label: "Email", kind: "email", required: false, unique: true },
  ],
  defaultPath: "/contacts",
  fileNamePattern: "{name}",
};

export const MOCK_RELATION: RelationEdge = {
  id: "rel01",
  sourceId: "01JTEST000000001",
  targetId: "01JTEST000000002",
  relationTypeId: "knows",
  createdAt: new Date("2024-01-01T00:00:00Z"),
};

export const MOCK_TAG: Tag = {
  id: "tag01",
  name: "client",
  path: "client",
};

export function createMockResolvers(overrides: Partial<Resolvers> = {}): Resolvers {
  return {
    listEntities: async (_filter: ListEntitiesFilter) => [MOCK_ENTITY],
    getEntity: async (id: string) => (id === MOCK_ENTITY.id ? MOCK_ENTITY : null),
    createEntity: async (data: CreateEntityInput) => ({ ...MOCK_ENTITY, typeId: data.typeId, fields: data.fields as Record<string, FieldValue>, body: data.body }),
    updateEntity: async (id: string, data: UpdateEntityInput) => {
      if (id !== MOCK_ENTITY.id) return null;
      return { ...MOCK_ENTITY, ...(data.fields ? { fields: data.fields as Record<string, FieldValue> } : {}), ...(data.body !== undefined ? { body: data.body } : {}), ...(data.tags ? { tags: data.tags } : {}) };
    },
    deleteEntity: async (id: string) => id === MOCK_ENTITY.id,
    listSchemas: async () => [MOCK_ENTITY_TYPE],
    getSchema: async (id: string) => (id === "contact" ? MOCK_ENTITY_TYPE : null),
    search: async (_opts: SearchOptions) => [MOCK_ENTITY],
    listRelations: async (_sourceId: string) => [MOCK_RELATION],
    getBacklinks: async (_entityId: string) => [MOCK_RELATION],
    createRelation: async (data: CreateRelationInput) => ({ ...MOCK_RELATION, sourceId: data.sourceId, targetId: data.targetId, relationTypeId: data.relationTypeId, fields: data.fields as Record<string, FieldValue> | undefined }),
    listTags: async () => [MOCK_TAG],
    listRelationTypes: async () => [] as RelationType[],
    ...overrides,
  };
}
