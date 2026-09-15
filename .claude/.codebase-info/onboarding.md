# Prise en main

*Last Updated: 2026-09-13*

## Démarrer

```bash
pnpm install
pnpm build:packages     # obligatoire, l'app consomme les dist/
pnpm dev                # http://localhost:3100
```

⚠️ `pnpm build:packages` n'est pas optionnel. L'application importe les paquets par leur `dist/`, donc sans build elle ne démarre pas.

⚠️ Sous WSL, le port 3100 peut être tenu par un service Windows invisible de `ss` et `ps`. Vite dérive alors sur 3101 sans le dire, ce qui casse les origines OAuth. Si une connexion Google échoue par fermeture de popup, vérifie le port réel.

Au premier lancement, l'application demande un dossier de coffre. « Continuer sans dossier » bascule en mode dégradé, suffisant pour voir l'interface mais pas pour la recherche ni les bases.

## Vérifier

```bash
pnpm typecheck     # doit passer avant tout commit
pnpm test:e2e      # 9 tests Playwright chromium
```

Il n'y a **pas de test unitaire** et c'est une décision. Ne crée pas de `*.test.ts`, ne réintroduis pas vitest. Le fichier `docs/dev/testing.md` dit le contraire : il est périmé, ignore-le.

## Tâches courantes

**Modifier un paquet `@supernote/*`.** Reconstruis-le, sinon rien ne change.
```bash
pnpm --filter @supernote/editor build
```

**Ajouter une propriété de champ persistée.** Quatre couches, et l'étape zod est celle qu'on oublie. Voir [patterns.md](patterns.md), section « La chaîne zod ».

**Déboguer le coffre.** En développement, le worker est exposé sous `window.__supernoteWorker`. Ses journaux sont réémis vers la console de l'onglet.

**Tester l'éditeur sans coffre.** La surface d'écriture de l'accueil fait tourner l'éditeur complet. La persistance expire mais l'édition fonctionne. Les pages Notes, elles, sont inutilisables sans coffre.

**Ajouter une page.** Crée `apps/web/src/app/<route>/page.tsx`, enveloppe dans `<AppShell>`, déclare la route dans `router.tsx` en `lazy`, ajoute l'entrée dans `lib/navigation/catalog.ts`. Publie le chrome mobile avec `useMobileTitle`, `useMobileFab` et `useMobileHeaderActions`, **depuis un composant rendu sous `AppShell`**, pas depuis celui qui le rend.

**Ajouter un composant.** Vérifie d'abord si `@supernote/ui` le fournit. L'application contourne ce paquet dans deux tiers des cas, ne creuse pas l'écart sans raison.

## Où lire en premier

| Ta question | Le document |
|---|---|
| comment ça s'assemble | [architecture.md](architecture.md) |
| par où ça démarre | [entry-points.md](entry-points.md) |
| quel paquet est vivant | [modules.md](modules.md) |
| pourquoi ça ne persiste pas | [patterns.md](patterns.md) |
| quelles tables existent | [database.md](database.md) |
| comment on écrit ici | [coding-style.md](coding-style.md) |

## Ce qui ment

- **`docs/dev/`**, onze fichiers, décrit l'architecture Electron. `apps/desktop` n'existe plus.
- **`README.md`** annonce Node 20+, pnpm 9+ et un packaging Electron. C'est Node 22 et pnpm 11, et il n'y a plus d'application desktop.
- **`packages/views`** n'existe pas malgré son répertoire.

## Règles non négociables

Elles vivent dans `CLAUDE.md` à la racine, et dans `.claude/live-rules/`. En résumé : HeroUI v3 pour l'interface, le mobile traité dans le même mouvement que le desktop, TypeScript strict sans `any`, zéro test unitaire, commits conventionnels en français, et jamais de commit sans demande explicite.
