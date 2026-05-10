/**
 * InlineMarkdown — minimal single-line markdown renderer for short labels
 * (todo text, list items, badges). Block-level constructs (paragraphs,
 * headings, lists) are intentionally NOT supported — those belong in the
 * full BlockNote editor, not in dense rows.
 *
 * Supported syntax (Markdown / GFM subset):
 *   `**bold**` or `__bold__`           → <strong>
 *   `*italic*` or `_italic_`           → <em>
 *   `~~strike~~`                       → <del>
 *   `` `code` ``                       → <code>
 *   `[label](url)`                     → <a target="_blank">
 *   `\*` `\_` `\`` `\\`                → literal punctuation (escapes)
 *
 * Nested formatting is honored (a `<strong>` can contain `<em>`, etc.).
 * Code spans are leaves — backticks swallow their content literally so
 * `` `**not bold**` `` renders as the four-character string.
 *
 * Pure function, zero deps. ~80 lines including JSDoc.
 */

import * as React from "react";

type Node =
  | { kind: "text"; value: string }
  | { kind: "code"; value: string }
  | { kind: "link"; href: string; children: Node[] }
  | { kind: "bold"; children: Node[] }
  | { kind: "italic"; children: Node[] }
  | { kind: "strike"; children: Node[] };

// Order matters: code is checked first so backticks swallow content
// before any other token gets a chance to match inside.
const TOKEN_PATTERNS: Array<{
  re: RegExp;
  build: (m: RegExpExecArray) => Node;
}> = [
  // Inline code — everything between matched backticks, no nesting.
  {
    re: /`([^`]+)`/,
    build: (m) => ({ kind: "code", value: m[1] ?? "" }),
  },
  // Link — [label](url). The label can contain nested inline formatting.
  {
    re: /\[([^\]]+)\]\(([^)\s]+)\)/,
    build: (m) => ({ kind: "link", href: m[2] ?? "", children: parse(m[1] ?? "") }),
  },
  // Bold — `**text**` or `__text__`. Greedy `[^*]+` keeps it single-line.
  {
    re: /\*\*([^*]+)\*\*|__([^_]+)__/,
    build: (m) => ({ kind: "bold", children: parse((m[1] ?? m[2]) ?? "") }),
  },
  // Strikethrough — `~~text~~`.
  {
    re: /~~([^~]+)~~/,
    build: (m) => ({ kind: "strike", children: parse(m[1] ?? "") }),
  },
  // Italic — single `*` or `_`. Done last so bold (`**`) wins first.
  {
    re: /(?<![*\w])\*([^*\n]+)\*(?!\*)|(?<![_\w])_([^_\n]+)_(?!_)/,
    build: (m) => ({ kind: "italic", children: parse((m[1] ?? m[2]) ?? "") }),
  },
];

/** Strip backslash escapes from plain text (e.g. `\*` → `*`). */
function unescape(s: string): string {
  return s.replace(/\\([\\*_`~[\](){}!#+-])/g, "$1");
}

function parse(input: string): Node[] {
  if (!input) return [];
  // Find the earliest match across all patterns; keep the one with the
  // lowest start index so the parse remains left-to-right.
  let earliest: { idx: number; m: RegExpExecArray; build: (m: RegExpExecArray) => Node } | null = null;
  for (const { re, build } of TOKEN_PATTERNS) {
    const m = re.exec(input);
    if (m && (earliest === null || m.index < earliest.idx)) {
      earliest = { idx: m.index, m, build };
    }
  }
  if (!earliest) return [{ kind: "text", value: unescape(input) }];

  const before = input.slice(0, earliest.idx);
  const matched = earliest.build(earliest.m);
  const after = input.slice(earliest.idx + earliest.m[0].length);

  const out: Node[] = [];
  if (before) out.push({ kind: "text", value: unescape(before) });
  out.push(matched);
  out.push(...parse(after));
  return out;
}

function renderNode(node: Node, key: number): React.ReactNode {
  switch (node.kind) {
    case "text":
      return <React.Fragment key={key}>{node.value}</React.Fragment>;
    case "code":
      return (
        <code
          key={key}
          className="rounded px-1 py-px font-mono text-[0.9em]"
          style={{
            backgroundColor: "var(--surface-3)",
            color: "var(--text-primary)",
          }}
        >
          {node.value}
        </code>
      );
    case "link":
      return (
        <a
          key={key}
          href={node.href}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="underline decoration-dotted underline-offset-2"
          style={{ color: "var(--accent)" }}
        >
          {node.children.map((c, i) => renderNode(c, i))}
        </a>
      );
    case "bold":
      return (
        <strong key={key} className="font-semibold">
          {node.children.map((c, i) => renderNode(c, i))}
        </strong>
      );
    case "italic":
      return (
        <em key={key} className="italic">
          {node.children.map((c, i) => renderNode(c, i))}
        </em>
      );
    case "strike":
      return (
        <del key={key} className="line-through">
          {node.children.map((c, i) => renderNode(c, i))}
        </del>
      );
  }
}

interface InlineMarkdownProps {
  /** Source text. Falsy values render an empty fragment. */
  text: string;
  /** Optional className on the wrapping span (typography control). */
  className?: string;
}

/**
 * Render a single line of text with inline markdown applied. Wrap in a
 * `<span>` so the parent's flex / truncation rules still apply. Memoize
 * the parsed AST on the text input to keep heavy lists cheap.
 */
export function InlineMarkdown({ text, className }: InlineMarkdownProps) {
  const nodes = React.useMemo(() => parse(text ?? ""), [text]);
  if (!text) return null;
  return (
    <span className={className}>
      {nodes.map((n, i) => renderNode(n, i))}
    </span>
  );
}
