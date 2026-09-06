import { z } from "zod";

// ── Shared primitives ─────────────────────────────────────────────────────────

export const FieldValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
  z.array(z.string()),
]);
export type FieldValue = z.infer<typeof FieldValueSchema>;

export const EntitySchema = z.object({
  id: z.string(),
  typeId: z.string(),
  typeName: z.string(),
  filePath: z.string(),
  fields: z.record(z.string(), FieldValueSchema),
  body: z.string(),
  tags: z.array(z.string()),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Entity = z.infer<typeof EntitySchema>;

// Summary keeps body OPTIONAL — the vault worker fills it on every list
// query, and the /todos page (notes-derived projection) needs it. Older
// callers that only consume metadata simply ignore the field.
export const EntitySummarySchema = EntitySchema.extend({
  body: z.string().optional(),
});
export type EntitySummary = z.infer<typeof EntitySummarySchema>;

export const SortOrderSchema = z.enum(["asc", "desc"]);
export type SortOrder = z.infer<typeof SortOrderSchema>;

export const PaginationSchema = z.object({
  // Bumped from 1000 to 10000 so /todos can pull every note's body in one
  // round-trip (the new model parses todos from markdown — no entity per
  // checkbox). Most callers stay at the 50 default.
  limit: z.number().int().positive().max(10000).default(50),
  offset: z.number().int().nonnegative().default(0),
});
export type Pagination = z.infer<typeof PaginationSchema>;

// ── Input schemas ─────────────────────────────────────────────────────────────

export const ListEntitiesInput = z
  .object({
    typeId: z.string().optional(),
    typeName: z.string().optional(),
    tags: z.array(z.string()).optional(),
    sortBy: z.string().optional(),
    sortOrder: SortOrderSchema.optional(),
  })
  .merge(PaginationSchema);
export type ListEntitiesInput = z.infer<typeof ListEntitiesInput>;

export const GetEntityInput = z.object({
  id: z.string().min(1),
});
export type GetEntityInput = z.infer<typeof GetEntityInput>;

/** Comptage pur (COUNT SQL) — aucune entité transportée. Pour les compteurs
 *  d'accueil qui n'avaient besoin que d'un nombre mais rapatriaient jusqu'à
 *  10 000 entités (bodies compris). */
export const CountEntitiesInput = z.object({
  typeId: z.string().optional(),
  typeName: z.string().optional(),
});
export type CountEntitiesInput = z.infer<typeof CountEntitiesInput>;

export const CountEntitiesOutput = z.object({
  count: z.number().int().nonnegative(),
});
export type CountEntitiesOutput = z.infer<typeof CountEntitiesOutput>;

/** Entités dont le champ date tombe dans [from, to). */
export const ListByDateRangeInput = z.object({
  /** Borne incluse, ISO datetime. */
  from: z.string().datetime(),
  /** Borne exclue, ISO datetime. */
  to: z.string().datetime(),
  field: z.enum(["createdAt", "updatedAt"]).default("createdAt"),
  typeName: z.string().optional(),
  limit: z.number().int().positive().max(100).default(10),
});
export type ListByDateRangeInput = z.infer<typeof ListByDateRangeInput>;

export const CreateEntityInput = z.object({
  typeId: z.string().min(1),
  fields: z.record(z.string(), FieldValueSchema),
  body: z.string().optional(),
  tags: z.array(z.string()).optional(),
});
export type CreateEntityInput = z.infer<typeof CreateEntityInput>;

export const UpdateEntityInput = z.object({
  id: z.string().min(1),
  fields: z.record(z.string(), FieldValueSchema).optional(),
  body: z.string().optional(),
  tags: z.array(z.string()).optional(),
  /**
   * Optional new on-disk path relative to the vault root, e.g.
   * "Travail/Projets 2025/ma-note.md". When provided AND different from the
   * current filePath, the worker treats this as a move: the old file is
   * deleted and the content is rewritten at the new location.
   */
  filePath: z.string().optional(),
});
export type UpdateEntityInput = z.infer<typeof UpdateEntityInput>;

/**
 * Déplacement vers un dossier, avec résolution du premier nom de fichier libre
 * côté worker. Contrairement à `update({ filePath })`, l'appelant ne choisit
 * pas le nom final : le test d'occupation doit être atomique avec l'écriture,
 * donc il ne peut pas vivre chez lui.
 */
export const MoveEntityIfFreeInput = z.object({
  id: z.string().min(1),
  /**
   * Dossier de destination, sans nom de fichier (ex. "Travail/Clients").
   * `"."` désigne la racine du coffre — une note qui y vivait doit pouvoir y
   * revenir quand on annule son rangement.
   */
  folder: z.string().min(1),
});
export type MoveEntityIfFreeInput = z.infer<typeof MoveEntityIfFreeInput>;

export const MoveEntityIfFreeOutput = z.object({
  /** Chemin réellement écrit (suffixé en `-2`, `-3`… si besoin). */
  filePath: z.string(),
  /** Faux quand la note était déjà à sa place. */
  moved: z.boolean(),
});
export type MoveEntityIfFreeOutput = z.infer<typeof MoveEntityIfFreeOutput>;

export const DeleteEntityInput = z.object({
  id: z.string().min(1),
  moveToTrash: z.boolean().optional().default(true),
});
export type DeleteEntityInput = z.infer<typeof DeleteEntityInput>;

export const SearchEntitiesInput = z.object({
  query: z.string().min(1),
  typeId: z.string().optional(),
  tags: z.array(z.string()).optional(),
  limit: z.number().int().positive().max(200).default(20),
});
export type SearchEntitiesInput = z.infer<typeof SearchEntitiesInput>;

export const GetRelatedInput = z.object({
  id: z.string().min(1),
  relationTypeId: z.string().optional(),
});
export type GetRelatedInput = z.infer<typeof GetRelatedInput>;

export const GetBacklinksInput = z.object({
  id: z.string().min(1),
});
export type GetBacklinksInput = z.infer<typeof GetBacklinksInput>;

// ── Output schemas ────────────────────────────────────────────────────────────

export const ListEntitiesOutput = z.object({
  items: z.array(EntitySummarySchema),
  total: z.number().int().nonnegative(),
});
export type ListEntitiesOutput = z.infer<typeof ListEntitiesOutput>;

export const SearchEntitiesOutput = z.object({
  items: z.array(EntitySummarySchema),
  total: z.number().int().nonnegative(),
});
export type SearchEntitiesOutput = z.infer<typeof SearchEntitiesOutput>;

/** Nombre de backlinks par entité cible (clé = entityId). */
export const BacklinkCountsOutput = z.object({
  counts: z.record(z.string(), z.number().int().nonnegative()),
});
export type BacklinkCountsOutput = z.infer<typeof BacklinkCountsOutput>;

export const BacklinkSchema = z.object({
  sourceId: z.string(),
  sourceFilePath: z.string(),
  context: z.string().optional(),
});
export type Backlink = z.infer<typeof BacklinkSchema>;

export const GetBacklinksOutput = z.array(BacklinkSchema);
export type GetBacklinksOutput = z.infer<typeof GetBacklinksOutput>;
