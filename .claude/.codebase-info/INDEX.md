# Carte du codebase — Supernote

*Last Updated: 2026-09-23*

**Système de connaissance et CRM personnel local-first**, livré comme PWA. Monorepo pnpm de 854 fichiers source. Pas de serveur applicatif : la base SQLite tourne dans un **Web Worker**, dans le navigateur. Une seule application, `apps/web`, et 15 paquets dont deux dorment.

Trois choses à savoir avant de toucher au code :

1. Les paquets `@supernote/*` sont consommés par leur **`dist/`**. Modifier leur source sans `pnpm build:packages` ne fait rien.
2. Une propriété de champ qui « ne persiste pas » se perd dans les **adaptateurs écrits à la main** (`components/schemas/adapters.ts`), pas dans zod : le routeur tRPC de `@supernote/ipc` n'est qu'un type, le worker est une table de routes qui ne valide rien à l'exécution.
3. Il y a **trois sources de coffre** aux comportements différents, dont un mode dégradé sans worker. Beaucoup de bugs viennent de les confondre.

## Documents

| Document | Quand l'ouvrir |
|---|---|
| [architecture.md](architecture.md) | comprendre comment l'ensemble s'assemble |
| [entry-points.md](entry-points.md) | savoir par où l'exécution commence |
| [directory-structure.md](directory-structure.md) | se repérer dans l'arborescence |
| [modules.md](modules.md) | **vérifier si un paquet est vivant avant d'y lire du code** |
| [patterns.md](patterns.md) | **les pièges, dont les adaptateurs de champs et ProseMirror** |
| [database.md](database.md) | tables, JSON dans les colonnes, recherche plein texte |
| [communication.md](communication.md) | pont worker, protocole, synchronisation en ligne |
| [coding-style.md](coding-style.md) | conventions, formatage, commentaires |
| [tech-landscape.md](tech-landscape.md) | versions, configuration, déploiement |
| [onboarding.md](onboarding.md) | démarrer, vérifier, tâches courantes |
| [sharing.md](sharing.md) | partage par lien, page invité, co-édition Yjs `/collab` |

## Documentation qui ment

`docs/dev/` décrit l'architecture Electron d'avant la migration. `apps/desktop` n'existe plus. `docs/dev/testing.md` prescrit du TDD vitest, l'inverse de la politique du projet. Traite ce répertoire comme de l'archive.

## Utiliser cette carte

Lis le document qui répond à ta question **avant** d'explorer l'arbre. Une exploration à l'aveugle sur 15 paquets coûte cher et rate les frontières. Chaque document cite des chemins réels, vérifiés à la date ci-dessus.

## Maintenir cette carte

Quand le code change de forme, pas à chaque commit, lance `update-codebase-map`. Les cas qui justifient une mise à jour : un paquet passe de dormant à vivant ou l'inverse, une frontière se déplace, un piège est corrigé, une migration retire un héritage. `.map-state.json` porte le commit de référence et les empreintes, ce qui rend la péremption détectable.

N'édite jamais `CLAUDE.md` depuis cette carte. Les règles du projet y vivent, la carte décrit ce qui est.
