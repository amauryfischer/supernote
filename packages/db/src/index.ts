/**
 * @supernote/db — Public API
 *
 * Exposes only what the main process needs:
 *  - `createClient(databaseUrl)` → PrismaClient instance
 *  - Prisma-generated types (re-exported as types only to avoid renderer leaks)
 *
 * DO NOT import runtime Prisma internals from the renderer process.
 */

export { createClient } from "./client.js";
export type { PrismaClient } from "./client.js";

// Re-export generated Prisma types (compile-time only)
export type {
  Vault,
  EntityType,
  RelationType,
  Entity,
  RelationEdge,
  Tag,
  EntityTag,
  Mention,
  View,
  Template,
  Automation,
  AutomationRun,
  Formula,
  Workflow,
  GitCommit,
  Plugin,
  Setting,
  Embedding,
  MentionType,
  AutomationKind,
  AutomationStatus,
  AutomationRunStatus,
  Prisma,
} from "./generated/prisma/index.js";
