# Journal des juges — /mail

## Décisions verrouillées

- Registre console : liste en colonnes dense, rail quand un fil est ouvert, cockpit « Aujourd'hui ».
- Ordre des sections : À toi, Étoilés, Todo, Aujourd'hui, puis chronologie.
- Couleur par personne dans le fil (pastille, nom, fond du message).
- En-tête du fil : Todo · Étoile · Fait · Reporter · Supprimer · Plus ; barre d'actions en bas sur mobile.
- Avatar = favicon du domaine, repli initiales. Actions de ligne au survol, en boutons icône.
- Pas de toasts, pas de dégradé de fond, HeroUI v3.

## Tours

| Tour | Juge A | Juge B | Correctifs |
|---|---|---|---|
| avant | 5,7 | 5,3 | — |
| 1 | 6,5 | 6,5 | objet prioritaire sur l'aperçu ; initiales d'avatar contrastées ; délai de réponse sur la ligne du message ; bandeau du fil réduit à l'attente ; braise sans anneau, filet de section plein |
| 2 | 6,4 | 6,5 | plateau (A/B : les deux préfèrent la version corrigée). Correctifs : aperçu masqué s'il n'a pas la place ; braise-texte assombrie en clair (`--sn-ember-ink`) ; nom d'expéditeur assombri dans la bulle ; délai de réponse aussi sur le message ouvert ; bandeau du fil sur une seule grille ; compteurs de section alignés |

## Passe « Aiguillage » (2026-11-24)

Verdict d'Amaury sur la passe précédente : « quasi aucun changement » (≈ 4/10 déduit), Orbite : « de l'idée, pas sûr de la direction ». Nouvelle direction : gare de triage par destin, lue dans ses labels.

| Tour | Juge A | Juge B | Correctifs |
|---|---|---|---|
| 1 | 6,1 (avant 4,5) | 6,4 (avant 4,6) | Communs : compteurs qui ne se recoupent pas, destin absent des lignes, mini-liste en double, mobile enterré. → la liste devient le quai (une voie filtre la liste, à travers les onglets), chips de ligne au nom et à la couleur de la voie, mini-liste et pastilles retirées, feuille mobile titrée « Aiguillage » |
| 2 | 6,8 | 6,6 | Les deux préfèrent le tour 2 sur 4-5 critères. Communs : on ne peut plus aiguiller, section repliée qui cache un fil de la voie, filtre signalé deux fois, compteurs. → bouton « aiguiller le fil sélectionné » sur chaque voie à label, bandeau unique avec « Ordre du jour », sections dépliées en mode voie, nature de la voie en clair |
| 3 | 6,6 | 6,6 | Plateau (6,7 → 6,6), arrêt au plafond de 3 tours. Les deux préfèrent le tour 3 sur l'Utilité (7). Communs non corrigés : aiguiller ne retire pas l'ancien label de destin (la voie d'origine perd le fil mais la chip reste) ; boutons d'aiguillage sans marque de la voie actuelle ni raccourci clavier ; mobile sans bouton d'aiguillage, en-tête de feuille doublé ; éventail jugé décoratif |

## Passe « Suivi » (2026-11-24, autonome sur /goal)

Voie « À aiguiller » et flèches retirées à la demande d'Amaury (verrouillé : il range lui-même). Ajouts : notes à soi → tâches (lot, voie, feuille mobile), « Tout ranger » sur Pour info, ruban de voies mobile, ordre du jour en cases à cocher. Corrigés : voie repliée en une ligne (prod), réponses aux clients comptées en notes à soi.

| Tour | Juge A | Juge B | Correctifs |
|---|---|---|---|
| 1 | 6,6 (avant 6,4) | 6,6 (avant 6,5) | Les deux préfèrent la nouvelle version (mobile, finition). Communs : tâches créées rangées dans « Éliminer », total de l'Aiguillage qui ne se recoupe pas, « email_ai_cache » visible dans Récent, « Dev/Dév », bandeau de voie tronqué sur mobile. → importance « high » (Planifier), « boîte · n sans voie », types techniques exclus de Récent, graphie alignée, nature de la voie masquée sous 768 px |
| 2 | 6,9 (avant 6,6) | 6,8 (avant 6,5) | Les deux préfèrent le tour 2 (utilité, finition, mobile). Communs : trois chiffres pour « à répondre » et deux totaux ; gloses de l'arbre tronquées ; colonne droite du shell vide sur /mail ; cercles « ○ ○ » de la barre du haut. → voie « À répondre » retirée de l'arbre (la section « À toi » la compte déjà), total nommé « tous onglets · n sans voie », gloses raccourcies. Non traités : colonne droite et cercles (shell global, hors /mail) |
| 3 | 6,8 (avant 6,5) | 6,9 (avant 6,6) | Plateau (6,85 → 6,85), arrêt au plafond de 3 tours. Les deux préfèrent le tour 3 (lisibilité, mobile). Communs : pastille « emails archivés » qui ne dit pas que des tâches sont créées (corrigé après le tour : « 2 tâches créées, fils rangés ») ; infobulle « Revoir toute la boîte » collée sur mobile ; ligne mobile de ~145 px (5-6 fils par écran) ; « + » sans libellé sous De/À ; « tous onglets » et « 2/8 » sans légende ; destin absent des lignes Pour info / Matrice. Non corrigés |

Bilan de la passe : à chaque tour les deux juges préfèrent la version la plus récente, mais les notes absolues restent plates entre 6,5 et 6,9 (la même version a reçu 6,85 puis 6,55 d'un tour à l'autre : bruit). Au tour 3, la colonne droite du shell, les icônes de la barre du haut et les onglets ont été exclus du jugement par moi, pas par Amaury. Voie « À répondre » retirée de l'arbre sur avis des juges : réversible, à confirmer par Amaury. Caractère bloqué à 7 sur les trois tours : aucun juge ne voit de nouvelle signature, seul l'arbre porte l'identité. Verdict d'Amaury : en attente.

### Après la série (non jugé)

- Aperçu sur une ligne en mobile, « + Label » dans le fil ouvert.
- Voies « à voir avec » et « délégué » : âge du fil le plus ancien (« délégué · 4 j »), date du dernier message du fil.
- « Tout marquer comme lu » d'un groupe met aussi à jour la liste cumulée (corrigé, non exercé au banc).
- Voies de réunion et « à voir avec » : bouton « Ouvrir l'ordre du jour en note » (note Inbox à cases à cocher, prouvé au banc).

### Verdict d'Amaury (2026-11-24) : aiguillage supprimé

« Je vois encore l'aiguillage qui était une mauvaise idée, à supprimer. » Volet, ruban mobile, bandeau de voie et `buildDestins` retirés. Restent : « Note à moi » sur les lignes, « En tâche(s), puis ranger », teinte des pastilles de label. Les juges préféraient chaque version à la précédente : leur avis ne valait rien ici.
