import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import type { TransportOutcome } from "./types.js";

export interface OfflineNote {
  id: string;
  title: string;
  typeId: string;
  tags?: string[];
  body?: string;
}

/** Write a markdown file directly to the vault (offline fallback). */
export async function writeNoteOffline(
  vaultPath: string,
  note: OfflineNote,
): Promise<TransportOutcome<{ filePath: string }>> {
  try {
    const folder = join(vaultPath, "Inbox");
    if (!existsSync(folder)) mkdirSync(folder, { recursive: true });

    const date = new Date().toISOString().slice(0, 10);
    const slug = note.title
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, "")
      .replace(/\s+/g, "-")
      .slice(0, 60);
    const fileName = `${date}-${slug || note.id}.md`;
    const filePath = join(folder, fileName);

    const frontmatter = [
      "---",
      `id: ${note.id}`,
      `title: "${note.title.replace(/"/g, '\\"')}"`,
      `type: ${note.typeId}`,
      note.tags?.length ? `tags: [${note.tags.map((t) => `"${t}"`).join(", ")}]` : null,
      `created: ${new Date().toISOString()}`,
      "_offline: true",
      "---",
    ]
      .filter(Boolean)
      .join("\n");

    const content = `${frontmatter}\n\n${note.body ?? ""}\n\n> _Note created offline — will be indexed at next app start._\n`;

    const dir = dirname(filePath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(filePath, content, "utf-8");

    return { ok: true, data: { filePath }, transport: "offline" };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message, transport: "offline" };
  }
}
