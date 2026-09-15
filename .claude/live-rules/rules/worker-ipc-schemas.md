---
description: "Chaîne de persistance d'une propriété de champ : le zod IPC strippe les clés inconnues"
globs: ["packages/ipc/**", "apps/web/src/components/schemas/**", "apps/web/src/worker/**"]
priority: 20
---
Le worker stocke la shape IPC : `type` (pas `kind`), `formulaExpr` (pas `expression`). Les adapters de `apps/web/src/components/schemas/adapters.ts` traduisent core ↔ IPC dans les deux sens.

Pour qu'une **nouvelle propriété de champ** survive au save, quatre couches, dans cet ordre :

1. **Worker = pass-through.** `entitiesCreate` / `schemasCreate` stockent `entity_type.fields` en `JSON.stringify` brut. Aucune modif worker n'est nécessaire pour persister une clé de plus.
2. ⚠️ **Mais le zod de sortie IPC strippe les clés inconnues.** `FieldDefinitionSchema` (`packages/ipc/src/schemas/schemas.ts`) doit déclarer la clé, sinon `schemas.list` / `schemas.get` la perdent à la lecture. `@supernote/ipc` est consommé via **dist** → `pnpm --filter @supernote/ipc build` après modif.
3. **Adapters les deux sens** : `ipcFieldToCore` (lecture) **et** `coreFieldToIpc` (écriture). Les seeds legacy stockent `kind` au lieu de `type` ; l'adapter accepte les deux.
4. **UI** : `ColumnEditorSidebar.tsx` → `FieldEditForm` (state, rendu conditionnel au kind, `handleSave`). Le slug est auto-dérivé du label via `makeSlug`, ne pas le ressaisir.

Symptôme typique d'un oubli de l'étape 2 : la valeur est bien écrite, disparaît au rechargement, et rien n'erreur.

Limite connue : `Cell.tsx` n'applique pas encore precision / min / max / format / currencyCode à l'affichage. La config persiste, le visuel ne la consomme pas.
