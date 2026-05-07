import matter from "gray-matter";
import path from "node:path";

export interface ParsedMarkdown {
  readonly frontmatter: Record<string, unknown>;
  readonly body: string;
}

export function parseMarkdown(content: string): ParsedMarkdown {
  const { data, content: body } = matter(content);
  return { frontmatter: data as Record<string, unknown>, body: body.trim() };
}

export function buildMarkdown(
  frontmatter: Record<string, unknown>,
  body: string
): string {
  const fm = matter.stringify(body, frontmatter);
  return fm;
}

/** Sanitize a filename to be safe across platforms */
export function sanitizeFilename(name: string): string {
  return name
    .replace(/[/\\:*?"<>|]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
}

/** Resolve output path within vault, honoring hierarchy */
export function resolveOutputPath(
  vaultRoot: string,
  folder: string,
  relPath: string
): string {
  return path.join(vaultRoot, folder, relPath);
}

/** Extract wikilink targets from markdown body */
export function extractWikilinks(body: string): string[] {
  const regex = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;
  const links: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(body)) !== null) {
    const target = match[1];
    if (target) links.push(target);
  }
  return links;
}

/** Extract hashtags from markdown body */
export function extractHashtags(body: string): string[] {
  const regex = /(?:^|\s)#([\w/-]+)/g;
  const tags: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(body)) !== null) {
    const tag = match[1];
    if (tag) tags.push(tag);
  }
  return [...new Set(tags)];
}
