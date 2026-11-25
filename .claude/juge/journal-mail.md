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

### Après le retrait (2026-11-25)

- Nouvelle base : écran sans aiguillage (prod d863f81). Règle : raccourcir un geste existant, pas de surface nouvelle.
- Raccourci `p` : « En tâche, puis ranger » sur le fil sélectionné ou ouvert, annulable par `z`, listé dans l'aide `?`. Prouvé au banc.
- « En tâche, puis ranger » dans le menu « Plus d'actions » du fil ouvert (c53e6d8), prouvé au banc mobile.
- Libellé « Extraire les actions » rendu visible sur mobile (ligne du menu sans texte).
- 2026-11-25 : Amaury autorise commit + déploiement de chaque lot vérifié sans redemander.

### Série 2 — écran sans aiguillage (grille avec décisions verrouillées)

| Tour | Juge A | Juge B | Correctifs |
|---|---|---|---|
| 1 | 6,2 | 6,5 | Communs corrigés : l'âge reste visible sur la ligne survolée/ouverte (actions à sa gauche) ; raccourcis clavier masqués dans le menu du fil sur mobile. Bug : « Novembre » → « novembre » (volet Aujourd'hui). Communs NON corrigés, à trancher par Amaury : la ligne sélectionnée se déplie (la liste saute au j/k) ; le panneau droit « Mes priorités » prend 1/5 de la largeur ; point orange à halo = « à toi » vs « non lu » peu lisible ; pastille Annuler qui recouvre la dernière ligne. |

Note d'Amaury sur cet écran : demandée, pas encore donnée.
| 1 bis | — | — | Amaury : « comme tu veux, j'ai dit autonome full ». Ligne sélectionnée à hauteur constante (plus de saut sous j/k), aperçu sur la ligne. Gardés tels quels par choix : braise orange « à toi » (élément-signature, chaleur = âge), panneau droit du shell (bascule de l'utilisateur), pastille Annuler flottante. |
| 2 | 7,0 | 7,1 | Les deux préfèrent la nouvelle version (hauteur constante, âge conservé). Communs corrigés : frise du fil — délai de réponse masqué sur mobile et séparé par « · » sur ordinateur ; titres de section en couleur secondaire. Non corrigés (un seul juge) : labels qui écrasent l'objet en 2 lignes, « hier » redondant dans la section HIER, fond de sélection peu marqué, carte du dernier message à fond teinté. Caractère à 6,5 chez les deux : inchangé, aucune surface nouvelle par décision verrouillée. |
| 2 bis | — | — | Cité par un juge à chaque tour : les labels écrasaient l'objet. Les pastilles de label cèdent maintenant la place avant l'objet, avec une largeur minimale lisible. |
| 3 | 6,7 | 6,7 | Recul (7,0/7,1 → 6,7) : le lot « labels qui cèdent la place » perdait de l'information (« Mel… », « Todo… ») — annulé. Communs corrigés : délai de réponse rendu à la frise mobile (heure seule quand le jour ne change pas) ; « En tâche, puis ranger » ajouté aux actions de survol d'une ligne. Les deux juges : 8 n'est pas atteignable par la finition seule (plafond 7,4-7,6), Caractère reste à 6,5 sans changement de structure. Série de 3 tours close. |

**Bilan série 2** : 6,2/6,5 → 7,0/7,1 → 6,7/6,7. Leçon : ne pas corriger un défaut cité par un seul juge à la fois (labels) — c'est ce qui a fait reculer la note.
- Après la série 2 : curseur clavier marqué par un liseré 3 px en couleur de texte (clair et sombre). Carte du dernier message laissée teintée : couleur par personne, validée en prod le 2026-10-27.
- Bug corrigé : « En tâche, puis ranger » sur un fil ouvert hors de la liste chargée (recherche, onglet Todo, lien direct) ne faisait rien, en silence. Le fil ouvert sert maintenant de source ; prouvé au banc. Frise mobile : jour comparé en heure locale.
- Abandonné sur avis : pas de refonte de la « grammaire de ligne » (idée d'un seul juge, la ligne était sur la liste « ne pas toucher » du tour 1), pas de série 3 tant que la preuve ne change pas (les juges plafonnent vers 7,5, écrit dans la grille).
- « En tâche, puis ranger » sur un fil déjà en tâche ouverte : pas de seconde tâche, le fil est seulement rangé. Prouvé au banc.

### Vérification sur la vraie boîte (2026-11-25, prod 8fff24c, lecture seule)

Aucun aiguillage ; 27 lignes, toutes à 34 px ; 88 notes à soi relevées par la requête (cache à jour) ; les réponses à des tiers restent « Moi ↗ » et non « Note à moi » ; action « En tâche, puis ranger » présente au survol. Non essayé : `p` lui-même (aurait modifié la boîte). Vu : bandeau « Quota Gmail atteint » transitoire, disparu une minute plus tard ; la requête des notes à soi coûte un appel par 30 min, elle n'en est pas la cause.
- Mesure sur la vraie boîte : chaque ouverture de /mail coûtait ~60 appels Gmail, dont ~51 pour relire les 50 derniers envoyés (suggestions de destinataires). Mis en cache 24 h. La synchro seule coûte 3 appels. Le refus de quota vu au chargement venait d'une passe complète de rattrapage (pic de 288 appels), guérie d'elle-même ; le consommateur extérieur reste non identifié.
- Cache des destinataires durci : clé par compte, jamais de liste vide figée, purgé à chaque envoi. Mesuré en prod après 681030f : ouverture de /mail = 3 appels Gmail au lieu de ~60.
- Quota, pistes fermées : serveur de push hors de cause (2 push/min au plus, watch 1×/jour). Console Google Cloud inaccessible : validation en deux étapes exigée par Google depuis le 2026-10-20, à activer par Amaury.

### Verdict d'Amaury (2026-11-25) : 5/10

« On va pas assez loin sur les fonctionnalités et sur ce qu'on met en avant, ça manque d'une touche wow, un truc innovant qui fasse la différence. » Écart avec les juges (6,7) : 1,7 point. Le critère manquant n'est pas la finition mais une fonction différenciante mise en avant. Suite demandée : 10 agents Haiku en idéation, meilleure idée croisée avec mon avis.

### Idéation à 10 agents Haiku (2026-11-25), un angle chacun, 30 idées

Convergences (idées citées indépendamment) : sujet à plusieurs fils / « Tour de table » 9 agents sur 10 (4 premiers choix) ; ordre du jour de réunion lié à l'agenda 7 sur 10 (1 premier choix) ; délégation close sur la réponse réelle 3 ; notes à soi routées ou converties 3 ; séance de vidange bornée 1 ; table/dossier par personne 2 (proche de l'aiguillage rejeté).
Mon croisement : retenir « Tour de table » en version déterministe (destinataires d'un envoi + réunion manuelle de fils, jamais de regroupement deviné), « Ordre du jour vivant » en second. Écarté : table par personne (redite de l'aiguillage), regroupement par objet ou IA (faux positifs). Verdict d'Amaury attendu avant toute mise en prod.
