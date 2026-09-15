---
target: arbre des notes (FileTree)
total_score: 22
p0_count: 0
p1_count: 3
timestamp: 2026-08-03T13-51-34Z
slug: apps-web-src-components-notes-filetree-tsx
---
⚠️ DEGRADED: single-context (délégation à des sous-agents interdite par la consigne de session)

## Score de santé design — FileTree.tsx

| # | Heuristique | Score | Problème clé |
|---|---|---|---|
| 1 | Visibilité de l'état système | 2 | Un déplacement de dossier ne produit aucun retour |
| 2 | Correspondance monde réel | 3 | Métaphore explorateur solide ; « VAULT » anglais dans UI française |
| 3 | Contrôle et liberté | 2 | Échap annule le drag, mais aucun undo après dépôt |
| 4 | Cohérence et standards | 3 | `(N)` aligné sur TagTree ; « Nouveau dossier » dupliqué |
| 5 | Prévention des erreurs | 2 | `void moveFolder(...)` sans `.catch` |
| 6 | Reconnaissance plutôt que rappel | 2 | Rien n'indique qu'un menu contextuel existe |
| 7 | Flexibilité et efficacité | 2 | Pas de filtre, pas de ↑/↓, pas de multi-sélection |
| 8 | Esthétique et minimalisme | 3 | Propre ; action de création dupliquée |
| 9 | Récupération d'erreur | 2 | Déplacement sans toast d'échec |
| 10 | Aide et documentation | 1 | Aucun indice sur glisser-pour-imbriquer ni clic droit |
| **Total** | | **22/40** | **Acceptable** |

## Verdict anti-patterns

Pas de slop : aucune grille de cartes, aucun dégradé, aucun eyebrow tracké.
`detect.mjs` sur FileTree.tsx : `[]`, exit 0 — mais un détecteur HTML/CSS ne voit
aucun des défauts de ce fichier, tous comportementaux ou de flex-layout. Scan
propre = pas une preuve. Overlays non tentés (headless).

## Ce qui marche

- Géométrie d'indentation : une seule échelle (ROW_INDENT_BASE/STEP) pilote
  padding, trait vertical et coude. Rien ne dérive.
- Gating lecture-seule des coffres montés (`isMountScoped`), côté UI et collision.
- Densité assumée : rangée 32px, compteur 12px, glyphes 14px.

## Problèmes prioritaires

### [P1] Débordement horizontal sur les noms longs
Bouton de rangée 307px dans un panneau de 280px ; `nav` déborde de 36px avec
barre de défilement. Label NON tronqué (scrollWidth === clientWidth === 237).
Cause : le bouton est `flex-1` mais garde `min-width: auto` — il ne peut pas
rétrécir sous son contenu, donc `truncate` ne s'enclenche jamais. Vérifié :
`min-width: 0` ramène 263px et débordement 0. Même défaut sur NoteRow et la
rangée de renommage. Fix : `min-w-0`. → /impeccable adapt

### [P1] Déplacement de dossier sans retour ni undo
`handleDragEnd` appelle `moveFolder` sans toast ni undo. `reorderFolders` fait
un rollback optimiste ; `moveFolder` non. Fix : toast avec action Annuler.
→ /impeccable harden

### [P1] Échec de déplacement avalé en silence
`void moveFolder(...)` sans `.catch` : rejet dans le vide, pas de toast, pas de
rollback. Le renommage a son catch + toast. → /impeccable harden

### [P2] Plus aucune affordance pour les actions de dossier
Depuis le retrait des « … », aucun pixel ne suggère le clic droit. Piste :
n'afficher le « … » que sur la rangée sélectionnée. → /impeccable onboard

### [P2] L'arbre ne passe pas à l'échelle
Aucun champ de filtre (inputs: [] dans l'aside), pas de ↑/↓ entre rangées,
aucun scrollIntoView sur la sélection. → /impeccable shape

## Signaux d'alerte par persona

**Alex (expert clavier, persona PRODUCT.md)** : 24 Tab pour atteindre le 12ᵉ
dossier, pas de filtre, pas de multi-déplacement.

**Sam (accessibilité)** : bon depuis la passe polish (plus de bouton imbriqué,
aria-expanded, focus accent). Restent : pas de `role="tree"` (aucun niveau ni
position annoncés), et aucun live region sur un déplacement réussi.

**Casey (mobile)** : icônes d'en-tête « Nouvelle note » et « Connecter un vault »
à 24×24 de zone de tap réelle (sondé elementFromPoint), sous le plancher de 32px
du CLAUDE.md. « Nouveau dossier » existe deux fois : trop petit en haut, bien
dimensionné en bas.

## Observations mineures

- « VAULT » en capitales anglaises dans une UI française.
- Poignées de drag permanentes au doigt sur chaque rangée : bruyant.
- Poignée d'un sous-dossier restée dans la gouttière racine à profondeur ≥ 1.
- Ligne « + N autres » non cliquable à la racine (disabled si folderPath === "").
- Aucun état vide pour l'arbre lui-même.

## Questions à considérer

- Le tri manuel mérite-t-il de partager la rangée avec l'imbrication ? Finder et
  VS Code n'ont qu'un geste de dépôt.
- Faut-il un arbre ET une liste centrale listant tous deux des notes ?
- À quoi ressemble cet arbre avec 200 dossiers ?
