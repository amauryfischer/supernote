# Bloc « Google Sheet » — embed PC / lien mobile

**Date** : 2026-06-17
**Statut** : design validé (direction tranchée avec l'utilisateur)

## Problème

Supernote ne permet pas d'« ouvrir » une Google Sheet. L'utilisateur veut
voir/référencer une feuille depuis ses notes, en respectant le fonctionnement
actuel et en marchant sur téléphone.

## Décision

Un **bloc custom BlockNote `googleSheet`** (pattern identique à `embed` /
`databaseView`), qui :

- **desktop** : affiche la feuille en `<iframe>` (vue « Publier sur le web ») ;
- **mobile** : affiche une carte avec un bouton « Ouvrir dans Google Sheets ».

C'est une feature **« fenêtre / référence »**, pas une intégration de données :
aucune base, formule, relation ou vue Supernote sur ces données. Lecture seule.

### Contraintes techniques (vérifiées)

1. **L'éditeur Google n'est pas iframable.** `https://docs.google.com/.../edit`
   renvoie `X-Frame-Options: SAMEORIGIN` → refus d'affichage cross-origin. Seule
   l'URL **« Publier sur le web »** `…/pubhtml?embedded=true` s'iframe, et c'est
   une **vue lecture-seule**. L'édition reste dans Google (bouton « ouvrir »).
2. **« Publier sur le web » expose une URL publique** (quiconque a le lien
   `pubhtml` voit). C'est différent d'un partage nominatif. L'UI doit le dire
   clairement. Accepté par l'utilisateur pour cette v1.
3. **L'iframe Google n'est pas responsive** sur téléphone (table à scroll
   horizontal) → sur mobile on ne l'affiche pas, on propose un lien propre
   (règle mobile CLAUDE.md : pas de débordement, hit-target tactile).

### Écartés (et pourquoi)

- **Miroir-base type Coda** (import readonly via OAuth) : plus lourd, vrai
  travail de mapping/relations/refresh. Reste l'option future si l'utilisateur
  veut *exploiter* les données (pas juste les voir). Hors scope v1.
- **Sync bidirectionnel** : conflits + stratégie row-id robuste. Hors scope.
- **gviz/CSV, service account, Apps Script** : pertinents seulement pour un
  miroir-base, pas pour un simple embed. Hors scope.

## Architecture

Le bloc suit le pattern **renderer délégué via Provider context** (exactement
`packages/editor/src/blocks/embed.tsx`) : le package `@supernote/editor` définit
le *block spec* + un slot de rendu ; `apps/web` fournit le *renderer* réel
(UI HeroUI + `useIsMobile`). Le package éditeur ne dépend jamais de `apps/web`.

```
@supernote/editor (dist — rebuild requis)
  blocks/googleSheet.tsx
    ├─ googleSheetBlockSpec   (createReactBlockSpec, prop `url`)
    ├─ GoogleSheetProvider / useGoogleSheetRenderer   (context, comme EmbedProvider)
    └─ fallback statique (lien) si pas de renderer
  blocks/googleSheetUrl.ts    (pur, testable)
    ├─ parseGoogleSheetUrl(url) → { spreadsheetId, gid } | null
    ├─ buildPubhtmlUrl({ spreadsheetId, gid }) → string   (…/pubhtml?embedded=true&gid=…&single=true)
    └─ buildOpenUrl({ spreadsheetId, gid }) → string      (…/edit#gid=…)
  serialization/serialize.ts  +  parse.ts   (round-trip markdown)
  schema.ts / blocks/index.ts (enregistrement)
  slash-menu (item « Google Sheet »)

apps/web
  components/notes/GoogleSheetEmbed.tsx   (le renderer)
    ├─ desktop : <iframe src={buildPubhtmlUrl(...)} />  conteneur responsive, hauteur réglable
    ├─ mobile  : carte titre + bouton HeroUI « Ouvrir dans Google Sheets » (buildOpenUrl)
    └─ état vide : Input HeroUI « coller l'URL d'une feuille publiée » + aide publish-to-web
  (câblage GoogleSheetProvider là où EmbedProvider/databaseView renderer est monté)
```

## Flux de données

- Le bloc stocke une seule prop : `url` (l'URL Google Sheets collée).
- `parseGoogleSheetUrl` en extrait `spreadsheetId` + `gid` ; le renderer
  construit l'URL pubhtml (desktop) ou l'URL d'ouverture (mobile/bouton).
- **Persistance** : sérialisé en markdown sur une ligne `[googleSheet url="…"]`
  (même mécanique que `[databaseView …]` / `[formula …]` ; `escapeAttr` /
  `unescapeAttr`). `parse.ts` reconnaît la ligne et reconstruit le bloc.
- **Aucun** appel worker / IPC / proxy / OAuth. L'iframe pubhtml est publique ;
  le bouton « ouvrir » ne fait qu'`window.open`.

## État vide & saisie

- Bloc inséré sans `url` → champ `Input` (HeroUI) « Coller l'URL d'une feuille
  Google publiée sur le web » + lien d'aide (Fichier › Partager › Publier sur le
  web). À la validation, on stocke l'URL dans la prop.
- Si l'URL n'est pas une Google Sheet valide (`parseGoogleSheetUrl` → null) →
  message inline, pas de crash.
- Si la feuille n'est pas publiée, l'iframe affiche la page d'erreur Google
  (non détectable cross-origin) → l'aide publish-to-web couvre ce cas.

## Insertion

- Item de slash-menu « Google Sheet » → insère un bloc `googleSheet` vide.
- Doit être insérable sur mobile aussi (le slash-menu mobile, ou l'équivalent
  d'insertion mobile existant).

## Gotchas (mémoire projet)

- **Éditeur consommé via `dist`** → rebuild `@supernote/editor` après chaque
  changement pour tester dans l'app.
- **MutationObserver ProseMirror** : ne jamais faire de `setAttribute` dans le
  sous-arbre éditeur. L'iframe et l'UI vivent dans un conteneur
  `contentEditable={false}` (comme `sn-embed`).
- Banc de test sans vault : WritingSurface de l'Accueil.

## Tests (vitest)

- `googleSheetUrl.test.ts` : extraction id/gid sur formats d'URL variés
  (`/edit#gid=`, `/edit?gid=`, `…/d/<id>/…`, URLs invalides → null) ; URLs
  construites correctes.
- `serialization.test.ts` : round-trip `googleSheet` ↔ `[googleSheet url="…"]`
  (y compris URL contenant des `"` → échappement).

## Hors scope (YAGNI v1)

- Pas d'OAuth/scope Sheets, pas de lecture des feuilles privées dans l'iframe.
- Pas de miroir-base, pas d'écriture, pas de refresh.
- Pas de hauteur auto par contenu (cross-origin impossible) → hauteur fixe
  raisonnable + poignée de redimensionnement éventuelle (nice-to-have).
- Pas de détection « feuille bien publiée » (cross-origin).
