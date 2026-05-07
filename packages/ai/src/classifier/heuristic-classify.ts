// ============================================================
// Heuristic entity type classification
// ============================================================

import type { EntityTypeInfo, TypeSuggestion } from "./types.js";

/** Built-in keyword signatures for common entity types */
const BUILT_IN_SIGNATURES: Array<{ typeName: string; patterns: RegExp[] }> = [
  {
    typeName: "Interaction",
    patterns: [
      /\b(réunion|meeting|appel|call|café|entretien|interview|rendez-vous|rdv|standup|sync)\b/i,
      /\b(participants?|attendees?|présents?)\b/i,
      /\b(compte.rendu|cr|notes? de réunion|meeting notes?)\b/i,
    ],
  },
  {
    typeName: "Tâche",
    patterns: [
      /\b(todo|task|tâche|à faire|action item|backlog|sprint)\b/i,
      /^\s*[-*]\s*\[[ xX]\]/m,
      /\b(priorité|priority|deadline|échéance|dû le|due)\b/i,
    ],
  },
  {
    typeName: "Recette",
    patterns: [
      /\b(recette|recipe|ingrédients?|ingredients?|étapes?|steps?|cuire|cook|four|oven)\b/i,
      /\b(g|kg|ml|cl|tasse|cup|cuillère|spoon)\b/i,
    ],
  },
  {
    typeName: "Personne",
    patterns: [
      /\b(contact|personne|person|email|téléphone|phone|linkedin|twitter)\b/i,
      /\b(né le|birthday|date de naissance)\b/i,
    ],
  },
  {
    typeName: "Projet",
    patterns: [
      /\b(projet|project|objectifs?|goals?|milestones?|roadmap|livrable|deliverable)\b/i,
      /\b(budget|timeline|équipe|team|stakeholders?)\b/i,
    ],
  },
  {
    typeName: "Journal",
    patterns: [
      /\b(aujourd'hui|today|ce matin|this morning|humeur|mood|journal|diary|log)\b/i,
      /^\s*##?\s*\d{4}-\d{2}-\d{2}/m,
    ],
  },
];

function scoreType(content: string, patterns: RegExp[]): number {
  const matches = patterns.filter((p) => p.test(content)).length;
  return matches / patterns.length;
}

export function heuristicClassify(
  noteContent: string,
  availableTypes: EntityTypeInfo[],
): TypeSuggestion[] {
  const results: TypeSuggestion[] = [];

  for (const entityType of availableTypes) {
    // Check user-defined keywords first
    if (entityType.keywords && entityType.keywords.length > 0) {
      const lowerContent = noteContent.toLowerCase();
      const matched = entityType.keywords.filter((kw) =>
        lowerContent.includes(kw.toLowerCase()),
      );
      if (matched.length > 0) {
        const confidence = Math.min(0.6 + (matched.length / entityType.keywords.length) * 0.3, 0.9);
        results.push({
          typeId: entityType.id,
          typeName: entityType.name,
          confidence,
          reason: `Keyword matches: ${matched.slice(0, 3).join(", ")}`,
          source: "heuristic",
        });
        continue;
      }
    }

    // Check built-in signatures
    const sig = BUILT_IN_SIGNATURES.find(
      (s) => s.typeName.toLowerCase() === entityType.name.toLowerCase(),
    );
    if (sig) {
      const score = scoreType(noteContent, sig.patterns);
      if (score > 0) {
        results.push({
          typeId: entityType.id,
          typeName: entityType.name,
          confidence: Math.min(0.5 + score * 0.4, 0.9),
          reason: `Pattern match (score: ${score.toFixed(2)})`,
          source: "heuristic",
        });
      }
    }
  }

  return results.sort((a, b) => b.confidence - a.confidence);
}
