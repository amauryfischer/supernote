# Conventions de code

*Last Updated: 2026-09-13*

Ces conventions viennent des fichiers de configuration **et** de ce que le code fait réellement. Les règles absolues du projet vivent dans `CLAUDE.md` à la racine ; ce document les complète sans les remplacer.

## Formatage

Prettier décide, il n'y a pas de débat à avoir.

| Réglage | Valeur |
|---|---|
| Largeur de ligne | 100 |
| Guillemets | simples |
| Point-virgule | oui |
| Virgule finale | partout |
| Indentation | 2 espaces |

Le plugin `prettier-plugin-tailwindcss` trie les classes utilitaires, et il connaît les fonctions `cn`, `cva` et `clsx`. Ne trie jamais à la main.

Lancer `pnpm format` pour écrire, `pnpm format:check` pour vérifier.

## TypeScript

Le socle `packages/tsconfig/base.json` active `strict`, plus trois options qui mordent au quotidien.

- `noUncheckedIndexedAccess` : un accès par index rend `T | undefined`. Il faut narrower, pas caster.
- `noImplicitOverride` : `override` est obligatoire sur une méthode qui en redéfinit une autre.
- `noFallthroughCasesInSwitch` : un `case` qui tombe dans le suivant est une erreur.

`noUnusedLocals` et `noUnusedParameters` sont **désactivés**, donc une variable inutilisée ne casse pas le typecheck. Nettoie quand même.

Interdits par `CLAUDE.md` : `any`, et les casts `as ... as never` non justifiés. `unknown` suivi d'un narrowing est la voie normale.

## Commentaires

La règle est restrictive et elle est dans `CLAUDE.md` : par défaut on n'écrit pas de commentaire. Un commentaire ne se justifie que par un **pourquoi non déductible** — contrainte externe, contournement de bug, invariant non évident, ordre d'opérations qui compte.

Ce que le code existant respecte bien : les en-têtes de fichier expliquent une contrainte réelle plutôt que de paraphraser le nom du module. Par exemple `apps/web/server.mjs` explique pourquoi il reste sans dépendance, et `apps/web/src/lib/pwa/PwaVaultSetup.tsx` explique pourquoi son arbre React garde toujours la même forme.

Interdit : la narration de session (« ajouté le 10/08 », « nouveau », « ancien code ci-dessous »), le commentaire qui redit le nom de la fonction, l'annonce d'étape numérotée.

Langue : **français**, aligné sur le fichier, une ligne au-dessus de ce qu'il explique.

## Nommage et organisation

- Les composants React sont en `PascalCase.tsx`, un composant principal par fichier.
- Les modules utilitaires sont en `kebab-case.ts`.
- Les pages suivent une convention héritée de Next : `src/app/<route>/page.tsx`, et `[param]` pour un segment dynamique. Le routeur les charge paresseusement.
- Un répertoire de composants expose souvent un `index.ts` de réexport ; importe depuis le répertoire, pas depuis le fichier profond.
- L'alias `@/` pointe la racine `apps/web/src`, résolu par `vite-tsconfig-paths`.

## Gestion d'erreur

Le projet préfère un type `Result` explicite à l'exception : `ok(v)` et `err(e)` depuis `@supernote/core/result`. Voir [patterns.md](patterns.md).

## Vérification

Il n'y a **pas de test unitaire** dans ce dépôt, et c'est une décision, pas un manque. Ne crée pas de `*.test.ts`, ne réintroduis pas vitest.

```
pnpm typecheck     # doit passer avant tout commit
pnpm test:e2e      # Playwright chromium, 9 tests
```

Voir [patterns.md](patterns.md) pour ce que la suite e2e couvre réellement.

## Commits

Conventional commits **en français** : `feat(scope):`, `fix(scope):`, `refactor(scope):`, `chore:`. Ne jamais commit sans demande explicite. Jamais de `--no-verify` sans demande explicite.
