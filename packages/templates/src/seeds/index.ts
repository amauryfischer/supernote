// ============================================================
// Seed templates — built-in starter templates
// ============================================================

import type { Template } from "../types.js";

export const MEETING_NOTES: Template = {
  id: "seed-meeting-notes",
  name: "Compte-rendu de réunion",
  description: "Meeting notes with participants, location, decisions and action items",
  icon: "users",
  body: "# Réunion {{prompt:Sujet?}} — {{date:YYYY-MM-DD HH:mm}}\n\n**Participants** : {{contact:personne}}\n**Lieu** : {{prompt:Lieu?|Visio}}\n\n## Notes\n{{cursor}}\n\n## Décisions\n\n## Actions",
};

export const RECIPE: Template = {
  id: "seed-recipe",
  name: "Recette",
  description: "Recipe template with ingredients and steps",
  icon: "chef-hat",
  body: "# {{prompt:Nom de la recette?}}\n\n- **Temps** : {{prompt:Temps de préparation?}}\n- **Difficulté** : {{select:Facile|Moyen|Difficile}}\n- **Personnes** : {{prompt:Pour combien?|4}}\n\n## Ingrédients\n- {{cursor}}\n\n## Étapes",
};

export const SEED_TEMPLATES: readonly Template[] = [
  MEETING_NOTES,
  RECIPE,
] as const;
