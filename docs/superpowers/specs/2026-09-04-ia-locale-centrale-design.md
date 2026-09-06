# IA locale centrale — design

**Date** : 2026-09-04
**Statut** : validé (déclenchement du tri choisi : passe sur l'inbox au repos)

## Le pari

L'IA locale cesse d'être une fonction cachée derrière un opt-in par note. Elle
devient un organe du shell : on voit son état, elle commente pendant qu'on
écrit, et elle range l'inbox toute seule. L'utilisateur écrit ; le classement
est un service rendu, pas une tâche.

Corollaire du pari du chantier flux : ce qui est **réversible** s'applique tout
seul (un déplacement de note, un tag existant) ; ce qui **crée du nouveau**
(une entité, un tag inédit) reste à confirmer.

## État des lieux vérifié

Le gros du moteur existe et n'est pas branché, ou branché mais éteint.

| Brique | Où | État réel |
|---|---|---|
| Commentaires IA par bloc | `components/notes/AiMarginsPanel.tsx`, `lib/ai/blockComments.ts` | Fonctionnel, debounce 2500 ms, cache par hash. Opt-in **par note** (`aiMargins` dans `note.fields`, `NoteEditor.tsx:282`), panneau `hidden lg:block` donc invisible sous 1024 px. Types : `suggestion \| question \| issue \| link`. |
| Auto-tag | `hooks/useAutoTag.ts` | Opt-in **off** (`supernote.ai.autoTag`). Contraint au vocabulaire de tags existant : tout tag inventé est filtré côté client. Skip total si le coffre n'a aucun tag. |
| Auto-titre | `hooks/useAutoTitle.ts` | Fonctionnel. Porte la sonde `probeOllama` + `readOllamaHost` réutilisées partout. |
| Classifier | `packages/ai/src/classifier/` | Suggère un **type d'entité**, pas un dossier. Ollama + repli heuristique. |
| Indicateur git | `lib/git/GitSyncIndicator.tsx` | Déjà dans `TopBar.tsx:244`. `return null` si `status === "disabled"` (l.26). |
| Indicateur online | `lib/online-sync/OnlineSyncIndicator.tsx` | Déjà dans `TopBar.tsx:245`. Même escamotage (l.27). |
| Indicateur IA | — | **N'existe pas.** |
| Déplacement de note | `components/notes/MoveNoteModal.tsx`, `NoteEditor.tsx:530` | `entities.update({ id, filePath })`. Les dossiers sont dérivés de `entity.filePath` + la clé de réglage `notes.folders` (`packages/ipc/src/router/folders.router.ts`). |
| Tri automatique | — | **N'existe pas.** |

## Bloc A — L'état visible dans le shell

Trois pastilles à gauche du dark mode, dans cet ordre : git, coffre en ligne, IA.

**Règle qui change tout** : une pastille ne disparaît jamais. « Non configuré »
est un état affiché (pastille neutre creuse + libellé au survol), pas une
absence. L'escamotage actuel produit exactement l'angoisse à laquelle ce bloc
répond : rien à l'écran ne distingue « synchronisé » de « pas de sync du tout ».

Nouvelle pastille IA (`AiStatusIndicator`), états :

- **connectée** — Ollama répond, modèle présent. Vert. Survol : hôte + modèle.
- **modèle manquant** — Ollama répond mais le modèle configuré n'est pas tiré. Ambre, action « Installer ».
- **injoignable** — pas de réponse, ou blocage CORS (`OLLAMA_ORIGINS`). Rouge, action « Reconnecter » qui resonde, et lien vers l'onglet IA des réglages.
- **désactivée** — l'utilisateur a coupé l'IA. Neutre creux.

La sonde réutilise `probeOllama` / `readOllamaHost` de `useAutoTitle` — pas de
seconde implémentation. Une sonde au montage, plus une resonde manuelle et une
resonde au retour d'onglet visible.

Mobile : pas trois pastilles dans une barre de 56 px. Une ligne « État » en tête
du `MoreDrawer` avec les trois, plus un point de couleur agrégé (le pire des
trois états) sur l'onglet « Plus ».

## Bloc B — Les marges IA, allumées et élargies

1. **Le réglage devient global**, avec surcharge par note. Une clé
   `supernote.ai.margins` (défaut **on**) ; `note.fields.aiMargins` continue de
   pouvoir forcer on/off sur une note précise. Le bouton ✦ existant bascule la
   surcharge de la note, pas le réglage global.
2. **Le panneau existe sous 1024 px.** Sous `lg`, il n'est pas une colonne mais
   un tiroir : un compteur discret dans la barre de la note (« 3 ») qui ouvre
   les commentaires en drawer. Le calcul tourne quelle que soit la largeur.
3. **Deux types de commentaire de plus**, qui sont la demande centrale :
   - `rewrite` — reformulation d'un passage lourd, avec le texte proposé et un
     bouton « Remplacer » (le chemin `onApplyFix` existe déjà).
   - `format` — mise en forme : ce paragraphe est une liste, ces trois lignes
     sont un tableau, ce bloc mérite un titre. Applique la transformation.
   Les prompts vivent dans `lib/ai/blockComments.ts`, à côté des quatre autres.
4. **Priorité au bloc en cours d'écriture.** Le bloc qui porte le caret passe en
   tête de file d'analyse au lieu d'être traité dans l'ordre du document.

## Bloc C — Le tag intelligent

L'auto-tag passe à **on par défaut** et perd sa contrainte de vocabulaire fermé,
avec la distinction qui protège l'utilisateur :

- un tag **déjà existant** dans le coffre s'applique tout seul (réversible, aucun
  bruit) ;
- un tag **inédit** arrive comme suggestion à confirmer — une puce sous le titre,
  « + facturation ? », qui ne crée le tag qu'au clic.

Sans cette distinction, un modèle local finit par créer quinze variantes du même
tag et le coffre devient inutilisable.

## Bloc D — Le tri de l'inbox, au repos

**Déclenchement** : une passe quand l'utilisateur est au repos — pas de frappe
depuis 60 s, onglet visible. Plus une passe au démarrage de l'application, et un
« Trier maintenant » explicite dans la pastille d'état. Jamais pendant la frappe :
rien ne doit bouger sous les doigts.

**Un déclenchement manuel passe outre les gardes de repos** — premier plan de
l'onglet, 60 s d'inactivité, ici comme dans les autres onglets. Ces gardes
existent pour ne pas surprendre quelqu'un qui n'a rien demandé, pas pour
l'empêcher d'agir ; même arbitrage que « Tout réanalyser » dans les marges IA.
Une interface qui nomme l'obstacle et pose juste en dessous un bouton arrêté par
ce même obstacle est pire que le silence qu'elle remplace. Restent opposables
même en manuel : une passe déjà en cours dans un autre onglet (deux passes
concurrentes déplaceraient deux fois les mêmes fichiers), la note ouverte, et la
confirmation avant toute création de dossier.

Une note d'inbox **ouverte en édition** (ici ou dans un autre onglet) est
**écartée de la passe** ; les autres sont traitées normalement. Renoncer à la
passe entière parce qu'une seule note est ouverte laissait le tri inerte au
moment précis où l'utilisateur l'attendait : sa note ouverte devant lui.

**Ce que la passe fait**, pour chaque note d'`inbox/` :

1. Construit la liste des dossiers existants (`vault.folders.list`).
2. Demande au modèle local le dossier le plus probable **parmi ceux-là**.
3. Sous un seuil de confiance, la note **reste dans l'inbox**. Ne pas ranger est
   un résultat acceptable ; ranger au hasard ne l'est pas.
4. Applique le déplacement via `entities.moveIfFree({ id, folder })` — le worker
   résout un nom de fichier libre de façon atomique, ce qu'un `filePath` choisi
   côté client ne peut pas garantir.

**Quand aucun dossier existant ne convient — ou qu'il n'en existe aucun — la
passe en propose un, et l'utilisateur confirme.**

L'interdiction d'origine (« l'IA ne crée jamais de dossier : sinon
l'arborescence prolifère et le rangement devient pire que l'absence de
rangement ») visait juste, mais tranchait trop large : sur un coffre neuf, sans
un seul dossier, elle rendait le bloc D **structurellement incapable de faire
quoi que ce soit**, en silence. L'invariant à tenir n'est pas « aucun dossier
n'est jamais suggéré », c'est **« aucun dossier n'apparaît sans un clic de
l'utilisateur »** — et la confirmation le tient : c'est lui, la barrière contre
la prolifération, pas le mutisme du modèle. C'est le patron déjà retenu ailleurs
dans ce chantier (l'extraction du Journal *propose* de créer un contact ; le
bloc C *propose* un tag inédit) plutôt qu'une exception.

Trois contraintes bordent la proposition :

- **un nom sobre et réutilisable** — un thème, un projet, un client ; un seul
  niveau, trois mots au plus, ni date ni paraphrase du titre de la note (validé
  côté client, pas seulement demandé au modèle) ;
- **un regroupement** — plusieurs notes de la passe qui relèvent du même dossier
  proposé arrivent sous **une seule** proposition, et deux propositions au plus
  par passe. Sept dossiers proposés pour sept notes seraient exactement la
  prolifération redoutée ;
- **un refus qui tient** — « Ne pas créer » mémorise le nom pour ce coffre, et
  le prompt des passes suivantes l'interdit explicitement.

**Une proposition en attente vit dans le panneau droit, sous « Suggestions
IA »**, avec les commentaires de marge. Une proposition de dossier obéit au même
contrat qu'eux — l'IA propose, l'utilisateur accepte ou écarte d'un clic — donc
elle va au même endroit, pas dans une pastille de 14 px qu'il faut penser à
ouvrir. Trois règles :

- **le rangement passe en premier**, au-dessus des commentaires de marge : il
  attend une décision, un commentaire de style peut patienter ;
- **il s'affiche qu'une note soit ouverte ou non** — c'est en écrivant qu'on
  tombe dessus. Il cohabite avec les commentaires de marge (qui gardent leur
  pleine hauteur sous lui) et ne remplace ni « Mes priorités » ni « Récent » ;
- **les deux gestes sont à un clic**, nom du dossier modifiable jusqu'au
  dernier moment.

**Une proposition est persistée** par coffre : c'est une décision qui attend
l'utilisateur, la perdre au rechargement lui retire le seul moment où le tri a
besoin de lui. Elle ne se dédouble pas non plus — les notes déjà portées par une
proposition sont écartées de la passe suivante, et une proposition dont les
notes ont quitté l'inbox entre-temps s'efface d'elle-même.

**Ce que l'utilisateur voit aussi** : un toast groupé en fin de passe, « 6 notes
rangées · Annuler · Voir » — ou « Dossier proposé : Clients · Confirmer… ».
« Voir » ouvre le journal : les déplacements avec leur destination et les mêmes
cartes de proposition ; « Annuler » remet les notes dans l'inbox. Le journal des
déplacements est gardé en mémoire pour la durée de la session.

**L'état de la passe est consultable en permanence**, dans une pastille de la
barre du haut jumelle de celle du bloc A (et une ligne du tiroir « Plus » sur
mobile) : un déclencheur compact, un popover qui dit l'état, **le geste à
faire**, et « Trier maintenant ». Chaque renoncement de la passe y pose une
phrase, parce que sans ça les cinq `return` silencieux du déclencheur racontaient
tous la même chose à l'utilisateur : « c'est cassé ».

**Le message doit nommer le vrai obstacle, pas l'obstacle habituel.** « La passe
démarre après 60 s sans frappe » est vrai en général et faux quand la seule note
d'inbox est ouverte dans l'éditeur : elle serait écartée de toute façon, et
l'utilisateur attendrait une minute pour rien. Un résultat de passe encore frais
prime donc sur cette promesse générique, et le cas « tout est ouvert » est
reconnu par le tick lui-même — sans appel au worker ni au modèle, et défait dès
que la note est fermée.

Le déplacement manuel reste ce qu'il est aujourd'hui, partout, sans changement.

## Hors périmètre

- **Création de dossier sans confirmation** de l'utilisateur, sous quelque forme
  que ce soit.
- Dossiers imbriqués proposés par l'IA (un seul niveau à la fois).
- Réorganisation rétroactive des notes hors inbox.
- Apprentissage à partir des corrections manuelles de l'utilisateur (phase 2 :
  une correction est un signal, mais il faut d'abord que le tri existe).
- Embeddings / RAG : les marges IA s'en passent aujourd'hui, ce chantier aussi.

## Ordre d'exécution

A (statut) → B (marges) → C (tags) → D (tri). A est petit et rend le reste
diagnosticable : sans pastille IA, un utilisateur dont Ollama est éteint vit les
blocs B/C/D comme des fonctionnalités qui ne marchent pas.
