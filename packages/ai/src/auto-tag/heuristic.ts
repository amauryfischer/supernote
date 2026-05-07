// ============================================================
// Heuristic fallback tagger — keyword matching + regex rules
// ============================================================

import type { AutoTagInput, AutoTagSuggestion, TagInfo } from "./types.js";

/** Keyword patterns that map to concept categories */
const KEYWORD_RULES: Array<{ pattern: RegExp; concept: string }> = [
  { pattern: /\b(meeting|réunion|standup|call|appel|sync)\b/i, concept: "meeting" },
  { pattern: /\b(todo|à faire|action item|tâche|task)\b/i, concept: "todo" },
  { pattern: /\b(family|famille|enfant|parent|perso|personnel)\b/i, concept: "perso" },
  { pattern: /\b(client|customer|prospect|vente|sales)\b/i, concept: "client" },
  { pattern: /\b(projet|project|milestone|sprint|roadmap)\b/i, concept: "project" },
  { pattern: /\b(recette|recipe|cuisine|ingrédient|cuire)\b/i, concept: "recette" },
  { pattern: /\b(finance|budget|dépense|revenu|facture|invoice)\b/i, concept: "finance" },
  { pattern: /\b(health|santé|médecin|doctor|sport|exercise)\b/i, concept: "sante" },
  { pattern: /\b(\d{4}-\d{2}-\d{2}|daily|journal|log)\b/i, concept: "journal" },
];

/**
 * Check if a tag path appears literally in the note content.
 * e.g. tag "perso" → search for "perso" in content.
 */
function tagPresentInContent(tag: TagInfo, content: string): boolean {
  const segments = tag.path.toLowerCase().split("/");
  const lowerContent = content.toLowerCase();
  return segments.some((seg) => seg.length > 2 && lowerContent.includes(seg));
}

/**
 * Find conceptual matches from keyword rules against existing tags.
 */
function matchKeywordRules(
  content: string,
  existingTags: TagInfo[],
): Array<{ tag: TagInfo; confidence: number }> {
  const matchedConcepts = new Set<string>();
  for (const rule of KEYWORD_RULES) {
    if (rule.pattern.test(content)) {
      matchedConcepts.add(rule.concept);
    }
  }

  const results: Array<{ tag: TagInfo; confidence: number }> = [];
  for (const tag of existingTags) {
    const tagLower = tag.path.toLowerCase();
    for (const concept of matchedConcepts) {
      if (tagLower.includes(concept)) {
        results.push({ tag, confidence: 0.65 });
        break;
      }
    }
  }
  return results;
}

export function heuristicSuggest(
  input: AutoTagInput,
  preferExisting: boolean,
): AutoTagSuggestion[] {
  const { noteContent, existingTags } = input;
  const suggestions: AutoTagSuggestion[] = [];
  const seen = new Set<string>();

  // Level 1: direct keyword presence of tag name in content
  for (const tag of existingTags) {
    if (tagPresentInContent(tag, noteContent)) {
      suggestions.push({
        tag: tag.path,
        confidence: 0.8,
        reason: "existing-match",
        source: "heuristic",
      });
      seen.add(tag.path);
    }
  }

  // Level 2: keyword rule concept matching against existing tags
  const ruleMatches = matchKeywordRules(noteContent, existingTags);
  for (const { tag, confidence } of ruleMatches) {
    if (!seen.has(tag.path)) {
      suggestions.push({
        tag: tag.path,
        confidence,
        reason: "keyword-rule",
        source: "heuristic",
      });
      seen.add(tag.path);
    }
  }

  // Level 3: if not preferExisting, suggest new tags from matched concepts
  if (!preferExisting) {
    const matchedConcepts = new Set<string>();
    for (const rule of KEYWORD_RULES) {
      if (rule.pattern.test(noteContent)) {
        matchedConcepts.add(rule.concept);
      }
    }
    for (const concept of matchedConcepts) {
      const existsAlready = existingTags.some((t) =>
        t.path.toLowerCase().includes(concept),
      );
      if (!existsAlready && !seen.has(concept)) {
        suggestions.push({
          tag: concept,
          confidence: 0.5,
          reason: "new-tag",
          source: "heuristic",
        });
        seen.add(concept);
      }
    }
  }

  return suggestions;
}
