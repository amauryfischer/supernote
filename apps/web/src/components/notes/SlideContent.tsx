"use client";

/**
 * SlideContent — rendu markdown compact d'une diapo de présentation.
 * Couvre titres, listes, citations, code, et inline (gras/italique/code/lien/
 * wikilink). Volontairement minimal : la présentation privilégie la lisibilité
 * sur la fidélité exhaustive de l'éditeur.
 */

import { useMemo } from "react";

function renderInline(text: string, keyBase: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  // Ordre : code inline, gras, italique, wikilink, lien markdown.
  const re = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*]+\*)|(\[\[[^\]]+\]\])|(\[[^\]]+\]\([^)]+\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    const k = `${keyBase}-${i++}`;
    if (tok.startsWith("`")) {
      out.push(
        <code key={k} className="rounded px-1" style={{ background: "var(--surface-2)", fontFamily: "ui-monospace, monospace", fontSize: "0.88em" }}>
          {tok.slice(1, -1)}
        </code>,
      );
    } else if (tok.startsWith("**")) {
      out.push(<strong key={k}>{tok.slice(2, -2)}</strong>);
    } else if (tok.startsWith("*")) {
      out.push(<em key={k}>{tok.slice(1, -1)}</em>);
    } else if (tok.startsWith("[[")) {
      const inner = tok.slice(2, -2);
      const label = inner.includes("|") ? inner.split("|")[1] : inner;
      out.push(<span key={k} style={{ color: "var(--accent)" }}>{label}</span>);
    } else {
      // [texte](url)
      const lm = /\[([^\]]+)\]\(([^)]+)\)/.exec(tok);
      if (lm) out.push(<span key={k} style={{ color: "var(--accent)", textDecoration: "underline" }}>{lm[1]}</span>);
      else out.push(tok);
    }
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

interface Block {
  kind: "h" | "p" | "ul" | "ol" | "quote" | "code";
  level?: number;
  items?: string[];
  text?: string;
}

function parseBlocks(md: string): Block[] {
  const lines = md.split("\n");
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? "";
    if (line.trim() === "") { i++; continue; }

    // Code fence
    if (/^\s*```/.test(line)) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i] ?? "")) { code.push(lines[i] ?? ""); i++; }
      i++;
      blocks.push({ kind: "code", text: code.join("\n") });
      continue;
    }
    // Heading
    const hm = /^(#{1,6})\s+(.*)$/.exec(line);
    if (hm) {
      blocks.push({ kind: "h", level: hm[1]!.length, text: hm[2]! });
      i++;
      continue;
    }
    // Blockquote
    if (/^\s*>\s?/.test(line)) {
      const q: string[] = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i] ?? "")) {
        q.push((lines[i] ?? "").replace(/^\s*>\s?/, ""));
        i++;
      }
      blocks.push({ kind: "quote", text: q.join(" ") });
      continue;
    }
    // Unordered list
    if (/^\s*[-*+]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i] ?? "")) {
        items.push((lines[i] ?? "").replace(/^\s*[-*+]\s+/, ""));
        i++;
      }
      blocks.push({ kind: "ul", items });
      continue;
    }
    // Ordered list
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i] ?? "")) {
        items.push((lines[i] ?? "").replace(/^\s*\d+\.\s+/, ""));
        i++;
      }
      blocks.push({ kind: "ol", items });
      continue;
    }
    // Paragraph (lignes consécutives)
    const para: string[] = [];
    while (
      i < lines.length &&
      (lines[i] ?? "").trim() !== "" &&
      !/^\s*```|^#{1,6}\s|^\s*>\s?|^\s*[-*+]\s+|^\s*\d+\.\s+/.test(lines[i] ?? "")
    ) {
      para.push(lines[i] ?? "");
      i++;
    }
    blocks.push({ kind: "p", text: para.join(" ") });
  }
  return blocks;
}

const H_SIZE: Record<number, string> = {
  1: "clamp(2rem, 5vw, 3.4rem)",
  2: "clamp(1.6rem, 3.6vw, 2.4rem)",
  3: "clamp(1.3rem, 2.6vw, 1.8rem)",
  4: "1.3rem",
  5: "1.15rem",
  6: "1rem",
};

export function SlideContent({ markdown }: { markdown: string }): React.JSX.Element {
  const blocks = useMemo(() => parseBlocks(markdown), [markdown]);
  return (
    <div className="flex flex-col gap-5" style={{ color: "var(--text-primary)" }}>
      {blocks.map((b, idx) => {
        const key = `b${idx}`;
        if (b.kind === "h") {
          return (
            <div
              key={key}
              style={{
                fontSize: H_SIZE[b.level ?? 2],
                fontWeight: 700,
                lineHeight: 1.15,
                letterSpacing: "-0.01em",
              }}
            >
              {renderInline(b.text ?? "", key)}
            </div>
          );
        }
        if (b.kind === "code") {
          return (
            <pre
              key={key}
              className="overflow-x-auto rounded-xl p-4"
              style={{ background: "var(--surface-2)", fontFamily: "ui-monospace, monospace", fontSize: "1rem" }}
            >
              <code>{b.text}</code>
            </pre>
          );
        }
        if (b.kind === "quote") {
          return (
            <blockquote
              key={key}
              className="pl-4"
              style={{ borderLeft: "3px solid var(--accent)", fontStyle: "italic", fontSize: "1.3rem", color: "var(--text-secondary)" }}
            >
              {renderInline(b.text ?? "", key)}
            </blockquote>
          );
        }
        if (b.kind === "ul" || b.kind === "ol") {
          const ListTag = b.kind === "ul" ? "ul" : "ol";
          return (
            <ListTag
              key={key}
              className={b.kind === "ul" ? "list-disc pl-7" : "list-decimal pl-7"}
              style={{ fontSize: "1.4rem", lineHeight: 1.6, display: "flex", flexDirection: "column", gap: "0.4rem" }}
            >
              {(b.items ?? []).map((it, j) => (
                <li key={`${key}-${j}`}>{renderInline(it, `${key}-${j}`)}</li>
              ))}
            </ListTag>
          );
        }
        return (
          <p key={key} style={{ fontSize: "1.4rem", lineHeight: 1.6 }}>
            {renderInline(b.text ?? "", key)}
          </p>
        );
      })}
    </div>
  );
}
