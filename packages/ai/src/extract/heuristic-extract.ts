// ============================================================
// Heuristic action and mention extraction
// ============================================================

import type { ExtractedAction, EntityRef, MentionMatch } from "./types.js";

// Regex patterns for action detection
const ACTION_PATTERNS: Array<{
  pattern: RegExp;
  priority: "high" | "medium" | "low";
}> = [
  { pattern: /^\s*[-*]\s*\[[ ]\]\s*(.+)/gm, priority: "medium" },
  { pattern: /\bTODO\s*[:\-]?\s*(.+)/gi, priority: "medium" },
  { pattern: /\bFIXME\s*[:\-]?\s*(.+)/gi, priority: "high" },
  { pattern: /\bACTION\s*[:\-]?\s*(.+)/gi, priority: "high" },
  { pattern: /(?:^|[\s:])à faire\s*[:\-]?\s*(.+)/gi, priority: "medium" },
  { pattern: /(?:^|[\s])il faut\s+(.+)/gi, priority: "medium" },
  { pattern: /(?:^|[\s])je dois\s+(.+)/gi, priority: "medium" },
  { pattern: /\bwe need to\s+(.+)/gi, priority: "medium" },
  { pattern: /\bneed to\s+(.+)/gi, priority: "low" },
];

const DEADLINE_PATTERNS: Array<RegExp> = [
  /\bd['']ici\s+(le\s+)?(\d{1,2}[\/\-]\d{1,2}(?:[\/\-]\d{2,4})?)/i,
  /\bby\s+(\d{4}-\d{2}-\d{2})/i,
  /\bdue\s+(\d{4}-\d{2}-\d{2})/i,
  /\béchéance\s*[:\-]?\s*(\d{1,2}[\/\-]\d{1,2}(?:[\/\-]\d{2,4})?)/i,
  /\bdeadline\s*[:\-]?\s*(\d{4}-\d{2}-\d{2})/i,
];

const ASSIGNEE_PATTERN = /@([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ\-.']{1,30})/g;

function extractDeadline(text: string): string | null {
  for (const pattern of DEADLINE_PATTERNS) {
    const match = pattern.exec(text);
    if (match) {
      return match[match.length - 1] ?? null;
    }
  }
  return null;
}

function extractAssignee(text: string): string | null {
  const match = ASSIGNEE_PATTERN.exec(text);
  ASSIGNEE_PATTERN.lastIndex = 0;
  return match ? (match[1] ?? null) : null;
}

function cleanActionText(text: string): string {
  return text
    .replace(ASSIGNEE_PATTERN, "")
    .replace(/\bd['']ici\s+(le\s+)?\S+/i, "")
    .replace(/\bby\s+\d{4}-\d{2}-\d{2}/i, "")
    .replace(/\bdue\s+\d{4}-\d{2}-\d{2}/i, "")
    .trim()
    .replace(/[.!?]+$/, "")
    .trim();
}

export function extractActionsHeuristic(noteContent: string): ExtractedAction[] {
  const results: ExtractedAction[] = [];
  const seen = new Set<string>();

  for (const { pattern, priority } of ACTION_PATTERNS) {
    const regex = new RegExp(pattern.source, pattern.flags);
    let match: RegExpExecArray | null;

    while ((match = regex.exec(noteContent)) !== null) {
      const rawText = (match[1] ?? match[0]).trim();
      const cleanedText = cleanActionText(rawText);

      if (!cleanedText || cleanedText.length < 3 || seen.has(cleanedText)) {
        continue;
      }
      seen.add(cleanedText);

      results.push({
        text: cleanedText,
        assignee: extractAssignee(rawText),
        deadline: extractDeadline(rawText),
        priority,
        source: "heuristic",
      });
    }
  }

  return results;
}

/**
 * Simple fuzzy name matching — checks if entity name or alias appears in text.
 */
function findEntityInText(
  content: string,
  entity: EntityRef,
): Array<{ matchedText: string; start: number; end: number; confidence: number }> {
  const candidates = [entity.name, ...(entity.aliases ?? [])];
  const matches: Array<{
    matchedText: string;
    start: number;
    end: number;
    confidence: number;
  }> = [];

  for (const candidate of candidates) {
    if (candidate.length < 2) continue;
    const escaped = candidate.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // `\b` s'appuie sur `\w`, qui reste `[A-Za-z0-9_]` même avec le flag `u` :
    // « José » ou « Chloé » suivis d'un espace n'ont donc aucune frontière et
    // ne sont jamais reconnus. Bornes Unicode explicites à la place.
    const pattern = new RegExp(
      `(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])`,
      "giu",
    );
    let m: RegExpExecArray | null;

    while ((m = pattern.exec(content)) !== null) {
      const isExactName = m[0] === entity.name;
      matches.push({
        matchedText: m[0],
        start: m.index,
        end: m.index + m[0].length,
        confidence: isExactName ? 0.9 : 0.7,
      });
    }
  }

  return matches;
}

export function extractMentionsHeuristic(
  noteContent: string,
  candidates: EntityRef[],
): MentionMatch[] {
  const results: MentionMatch[] = [];

  for (const entity of candidates) {
    const found = findEntityInText(noteContent, entity);
    for (const match of found) {
      results.push({
        entityId: entity.id,
        entityName: entity.name,
        matchedText: match.matchedText,
        confidence: match.confidence,
        startOffset: match.start,
        endOffset: match.end,
        source: "heuristic",
      });
    }
  }

  return results.sort((a, b) => a.startOffset - b.startOffset);
}
