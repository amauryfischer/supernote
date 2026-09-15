---
description: "Socle d'implémentation : réutiliser avant d'écrire, plus petit correctif à la racine"
priority: 30
---
Comprends le flux avant de le changer. Demande-toi d'abord si le changement doit exister, puis réutilise un chemin de code existant avant d'en ajouter un. Préfère dans cet ordre : stdlib, plateforme native, dépendance déjà installée, code neuf.

Vise le plus petit correctif clair **à la racine partagée** plutôt qu'un patch par appelant. Avant d'éditer une fonction, grep ses appelants : un garde dans la fonction commune est un diff plus court qu'un garde partout, et corriger le seul chemin cité par le ticket laisse les frères cassés.

Préfère la suppression et le code direct aux couches, wrappers, abstractions spéculatives, boutons de config et process. Ne garde du code que s'il porte un comportement démontré ou un vrai plancher de sûreté.

Ne simplifie jamais : la validation aux frontières de confiance, la gestion d'erreur qui évite une perte de données, la sécurité, l'accessibilité, ni ce qui a été explicitement demandé.

**Vérification sur ce projet** : `pnpm typecheck` doit passer, plus les e2e Playwright (`pnpm test:e2e`) quand le comportement touché y est couvert. Politique zéro test unitaire : ne crée pas de `*.test.ts`, ne réintroduis pas vitest. Dis ce que tu as réellement lancé, ne présente pas un mock comme une exécution réelle.
