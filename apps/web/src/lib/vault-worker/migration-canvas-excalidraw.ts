// ============================================================
// migration-canvas-excalidraw — one-shot extraction of legacy canvas
// JSON (stored in `.md` frontmatter as `fields.data` or `fields.canvas`)
// into standalone `.excalidraw` sibling files.
//
// Idempotent: rows that already carry `canvasFile` are skipped.
// Non-destructive: on any per-row failure we log and move on without
// mutating the row. If a `.excalidraw` already exists with different
// content we skip rather than overwrite — the user resolves manually.
// ============================================================

import {
  canvasToFileBridge,
  excalidrawSiblingPath,
} from "@supernote/canvas/excalidraw";
import type { Database } from "./sqlite-adapter";
import {
  parseFrontmatter,
  serializeFrontmatter,
  readVaultFile,
  writeVaultFile,
} from "./fsa-file-io";

interface CandidateRow {
  id: string;
  filePath: string;
  fields: string;
}

function rows(result: ReturnType<Database["exec"]>): CandidateRow[] {
  if (result.length === 0) return [];
  const r = result[0];
  if (!r) return [];
  const cols = r.columns;
  return r.values.map((v) => {
    const obj: Record<string, unknown> = {};
    cols.forEach((c, i) => {
      obj[c] = v[i];
    });
    return obj as unknown as CandidateRow;
  });
}

export async function migrateCanvasesToExcalidraw(args: {
  db: Database;
  vaultHandle: FileSystemDirectoryHandle;
  vaultId: string;
}): Promise<number> {
  const { db, vaultHandle, vaultId } = args;
  const candidates = rows(
    db.exec(`SELECT id, filePath, fields FROM entity WHERE vaultId = ?`, [vaultId]),
  );

  let migrated = 0;
  for (const r of candidates) {
    let fields: Record<string, unknown>;
    try {
      fields = JSON.parse(r.fields || "{}");
    } catch {
      continue;
    }
    if (typeof fields["canvasFile"] === "string") continue;

    let fieldName: "data" | "canvas" | null = null;
    let json: string | null = null;
    for (const n of ["data", "canvas"] as const) {
      const v = fields[n];
      if (typeof v === "string" && v.trim().startsWith("{")) {
        fieldName = n;
        json = v;
        break;
      }
    }
    if (!fieldName || !json) continue;

    let parsed: { nodes?: unknown; edges?: unknown; excalidrawElements?: unknown };
    try {
      parsed = JSON.parse(json);
    } catch (err) {
      console.warn("[migrate-canvas] skip — JSON parse failed", r.filePath, err);
      continue;
    }
    const doc = {
      nodes: Array.isArray(parsed.nodes) ? parsed.nodes : [],
      edges: Array.isArray(parsed.edges) ? parsed.edges : [],
      ...(Array.isArray(parsed.excalidrawElements)
        ? { excalidrawElements: parsed.excalidrawElements }
        : {}),
    };

    const sibling = excalidrawSiblingPath(r.filePath);
    if (!sibling) continue;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bridge = canvasToFileBridge({ mdPath: r.filePath, doc: doc as any });
    if (!bridge) continue;

    // Conflict guard: skip rather than overwrite existing user data.
    try {
      const existing = await readVaultFile(vaultHandle, sibling.split("/"));
      if (existing && existing.trim() !== bridge.excalidrawContent.trim()) {
        console.warn(
          "[migrate-canvas] skip — sibling exists with different content",
          r.filePath,
        );
        continue;
      }
    } catch {
      // Missing sibling — proceed.
    }

    try {
      await writeVaultFile(
        vaultHandle,
        sibling.split("/"),
        bridge.excalidrawContent,
      );

      // Rewrite the .md: strip the JSON field, add canvasFile.
      const mdContent = await readVaultFile(vaultHandle, r.filePath.split("/"));
      const parsedFm = parseFrontmatter(mdContent);
      const frontmatter = parsedFm.frontmatter as Record<string, unknown>;
      delete frontmatter[fieldName];
      frontmatter["canvasFile"] = bridge.canvasFileFrontmatter;
      await writeVaultFile(
        vaultHandle,
        r.filePath.split("/"),
        serializeFrontmatter(frontmatter, parsedFm.body),
      );

      // Update DB row.
      delete fields[fieldName];
      fields["canvasFile"] = bridge.canvasFileFrontmatter;
      db.run(`UPDATE entity SET fields = ? WHERE id = ?`, [
        JSON.stringify(fields),
        r.id,
      ]);
      migrated += 1;
    } catch (err) {
      console.error("[migrate-canvas] failed for", r.filePath, err);
    }
  }

  return migrated;
}
