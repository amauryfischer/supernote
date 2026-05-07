import type { QueryAst, Filter, CompiledQuery } from "./types.js";

// ---------------------------------------------------------------------------
// FTS5 expression builder
// ---------------------------------------------------------------------------

function escapeFts(word: string): string {
  // Wrap in double quotes to handle special chars, but allow FTS5 operators
  return `"${word.replace(/"/g, '""')}"`;
}

function buildFtsExpr(ast: QueryAst): string {
  const parts: string[] = [];

  // Free-text words (AND-joined implicitly)
  for (const word of ast.freeText) {
    parts.push(escapeFts(word));
  }

  // Exact phrases
  for (const phrase of ast.phrases) {
    parts.push(`"${phrase.replace(/"/g, '""')}"`);
  }

  // Excluded terms
  for (const excl of ast.excluded) {
    parts.push(`NOT ${escapeFts(excl)}`);
  }

  // Tag filter → search in tags column
  const tagFilters = ast.filters.filter((f) => f.key === "tag");
  for (const tf of tagFilters) {
    parts.push(`tags:${escapeFts(tf.value)}`);
  }

  return parts.join(" AND ");
}

// ---------------------------------------------------------------------------
// SQL predicates builder
// ---------------------------------------------------------------------------

function filterToSql(filter: Filter): { sql: string; params: unknown[] } | null {
  switch (filter.key) {
    case "type":
      return { sql: "e.typeId = ?", params: [filter.value] };

    case "path":
      return { sql: "e.filePath LIKE ?", params: [`%${filter.value}%`] };

    case "tag":
      // Handled via FTS column; also add a SQL join for precision
      return {
        sql: `EXISTS (
          SELECT 1 FROM entity_tag et
          JOIN tag t ON t.id = et.tagId
          WHERE et.entityId = e.id AND t.path = ?
        )`,
        params: [filter.value],
      };

    case "created":
      return buildDateSql("e.createdAt", filter.op, filter.value);

    case "modified":
      return buildDateSql("e.updatedAt", filter.op, filter.value);

    case "in":
      // entity is in a path/vault context
      return { sql: "e.filePath LIKE ?", params: [`${filter.value}%`] };

    case "field":
      // field:name=value syntax (value contains "name=val")
      return buildFieldSql(filter.value);

    case "relation":
      return {
        sql: `EXISTS (
          SELECT 1 FROM relation_edge re
          WHERE (re.sourceId = e.id OR re.targetId = e.id)
          AND re.relationTypeId = ?
        )`,
        params: [filter.value],
      };

    default:
      return null;
  }
}

function buildDateSql(
  column: string,
  op: string,
  value: string,
): { sql: string; params: unknown[] } {
  const sqlOp = op === "=" ? "=" : op;
  return { sql: `${column} ${sqlOp} ?`, params: [value] };
}

function buildFieldSql(
  value: string,
): { sql: string; params: unknown[] } | null {
  // Expect "fieldName=fieldValue" syntax
  const eqIdx = value.indexOf("=");
  if (eqIdx === -1) return null;
  const fieldName = value.slice(0, eqIdx);
  const fieldValue = value.slice(eqIdx + 1);
  return {
    sql: `json_extract(e.fields, '$.${fieldName}') = ?`,
    params: [fieldValue],
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Compile a QueryAst into:
 * - ftsExpr: a ready-to-use FTS5 MATCH expression
 * - sqlPredicates: additional WHERE clauses for the entity table
 */
export function compileToFtsAndPredicates(ast: QueryAst): CompiledQuery {
  const ftsExpr = buildFtsExpr(ast);
  const sqlPredicates: Array<{ sql: string; params: unknown[] }> = [];

  for (const filter of ast.filters) {
    const pred = filterToSql(filter);
    if (pred) sqlPredicates.push(pred);
  }

  return { ftsExpr, sqlPredicates };
}
