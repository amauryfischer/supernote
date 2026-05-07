import matter from "gray-matter";
import { unified } from "unified";
import remarkParse from "remark-parse";
import type { Root } from "mdast";

export interface ParsedMarkdownFile {
  readonly frontmatter: Record<string, unknown>;
  readonly body: string;
  readonly ast: Root;
}

/**
 * Parse a full markdown file (with optional YAML frontmatter) into
 * structured parts: frontmatter object, raw body string, and mdast AST.
 */
export function parseMarkdownFile(content: string): ParsedMarkdownFile {
  const { data: frontmatter, content: body } = matter(content);

  const processor = unified().use(remarkParse);
  const ast = processor.parse(body) as Root;

  return { frontmatter, body, ast };
}
