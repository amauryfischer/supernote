"use client";

import type { QueryAst } from "@supernote/search";

interface AstPreviewProps {
  ast: QueryAst;
}

export function AstPreview({ ast }: AstPreviewProps) {
  const parts: string[] = [];

  if (ast.freeText.length > 0) {
    parts.push(`mots: [${ast.freeText.join(", ")}]`);
  }
  if (ast.filters.length > 0) {
    parts.push(`filtres: [${ast.filters.map((f) => `${f.key}${f.op}${f.value}`).join(", ")}]`);
  }
  if (ast.phrases.length > 0) {
    parts.push(`phrases: ["${ast.phrases.join('", "')}"]`);
  }
  if (ast.excluded.length > 0) {
    parts.push(`exclus: [${ast.excluded.join(", ")}]`);
  }

  if (parts.length === 0) return null;

  return (
    <div
      className="rounded-md border px-3 py-1.5 font-mono text-[10px] leading-relaxed"
      style={{
        backgroundColor: "var(--surface-1)",
        borderColor: "var(--border-subtle)",
        color: "var(--text-muted)",
      }}
    >
      AST: {parts.join(" | ")}
    </div>
  );
}
