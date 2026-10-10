/**
 * Route `entities.noteChecklists` : extrait les lignes de checklist des notes
 * côté worker pour que les corps de notes ne traversent plus la frontière.
 */

import type { NoteChecklistRow } from "@supernote/ipc";
import { extractChecklists } from "../todos/extractChecklists";
import { filterChecklistsHeuristic } from "../todos/heuristicFilter";
import type { Database } from "./sqlite-adapter";
import type { RouteHandler } from "./worker-router";
import { rows } from "./sql";
import { decodeTagPaths } from "./tag-paths";

function parseFields(raw: unknown): Record<string, unknown> {
  if (typeof raw !== "string" || !raw) return {};
  try {
    const v: unknown = JSON.parse(raw);
    return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export function buildChecklistRoutes(db: Database, vaultId: string): Record<string, RouteHandler> {
  const noteChecklists = async (): Promise<NoteChecklistRow[]> => {
    const notes = rows(
      db.exec(
        `SELECT e.id, e.filePath, e.fields, e.body, e.updatedAt,
                (SELECT GROUP_CONCAT(t.path, char(31))
                   FROM entity_tag etag
                   JOIN tag t ON t.id = etag.tagId
                  WHERE etag.entityId = e.id) AS tagPaths
           FROM entity e
          WHERE e.vaultId = ? AND e.typeId = 'note' AND instr(e.body, '[') > 0
          ORDER BY e.updatedAt DESC`,
        [vaultId],
      ),
    );
    const out: NoteChecklistRow[] = [];
    for (const n of notes) {
      const fields = parseFields(n["fields"]);
      // Notes archivées : leurs checklists restent hors du tableau actif jusqu'à restauration.
      const archivedAt = fields["archivedAt"];
      if (typeof archivedAt === "string" && archivedAt.length > 0) continue;
      const body = typeof n["body"] === "string" ? n["body"] : "";
      const items = extractChecklists(body);
      if (items.length === 0) continue;
      const kept = filterChecklistsHeuristic(body, items);
      if (kept.length === 0) continue;
      const filePath = String(n["filePath"] ?? "");
      const noteTitle =
        typeof fields["title"] === "string"
          ? fields["title"]
          : filePath.split("/").pop()?.replace(/\.md$/, "") || "Sans titre";
      const noteTags = decodeTagPaths(n["tagPaths"]);
      for (const it of kept) {
        out.push({
          noteId: String(n["id"]),
          noteTitle,
          noteTags,
          noteUpdatedAt: String(n["updatedAt"] ?? ""),
          line: it.line,
          blockId: it.blockId,
          text: it.text,
          done: it.done,
          priority: it.priority,
          importance: it.importance,
          urgent: it.urgent,
          startDate: it.startDate,
          dueDate: it.dueDate,
        });
      }
    }
    return out;
  };

  return { "entities.noteChecklists": noteChecklists };
}
