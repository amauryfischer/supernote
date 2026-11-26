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

### 2026-11-26 — fonctions demandées par Amaury : ordre du jour + sujet à plusieurs fils

- Tour de table (2726b6b) : dans un fil où j'ai écrit à ≥ 2 personnes, compte des réponses, noms des silencieux, relance préremplie à eux seuls. Demande = mon premier message à ≥ 2 destinataires ; seul `To` compte (le miroir ne stocke pas `Cc`).
- Ordre du jour (719cc48) : en tête de boîte, réunions des 7 prochains jours rapprochées d'un label (mots du label dans le titre ; participant unique pour « voir avec X »). Pas de lien explicite label↔réunion : à ajouter si le rapprochement rate sur la vraie boîte.
- Sujet à plusieurs fils : sélection de ≥ 2 fils → label Gmail `Sujet/<titre>` ; tour de table calculé sur tous les fils du label, lus par requête `label:` (un fil rangé reste compté) ; relance depuis le fil de la demande ; « Clore le sujet » supprime le label.
- Preuves au banc : 2/6 et les 4 bons noms ; 4/6 après réunion de 3 fils ; compte inchangé après rangement ; réunion sans label correspondant = rien d'affiché.
### Idéation à 10 agents, 2ᵉ passe (2026-11-25) : 40 idées → 18, classées

Un angle par agent (temps, boucles ouvertes, pont coffre, gestes, répondre, premiers principes, inbox programmable, veille 2025-26, mobile, signature). Barème : utilité 30 %, wow 25 %, goûts verrouillés 20 %, faisabilité 15 %, mobile 10 %.
Tête : 1. Parapheur (questions + promesses, 5 agents, 8,4) · 2. Réveil sur preuve — Relais, Quittance, réveils conditionnels (8,2) · 3. Gestes rejoués/prédits (8,1, registre « raccourcir », pas la touche wow) · 4. Ligne de flottaison boîte × agenda (7,8) · 5. Contrats de réponse (7,5) · 6. Relevé mail → ligne de Base (7,3, le plus différenciant, effort L).
Écarté en tête d'affiche : Arrivée unique (section « Capture » dans /mail, proche des surfaces rejetées).

### Prototype Parapheur (2026-11-25, branche, non déployé)

- Grille : questions du dernier message reçu, mot pour mot, règles fixes (« ? », « merci de me confirmer… », « dis-moi »), politesse et signature écartées. `r` ouvre la grille tant que la réponse est vide ; o oui · n non · l « je reviens vers vous d'ici <jour> » · 1-3 créneau libre de l'agenda (questions de date, agenda synchronisé seulement) · e écrire. La réponse s'écrit sous « question » citée entre guillemets ; tranchée = citation suivie d'une réponse. Envoi retenu une fois si la grille a servi et qu'une question reste ouverte.
- Promesses : phrases à la 1ʳᵉ personne, fermes, datées (`findFrenchDeadline`), repérées à la frappe ; éteintes par défaut, « Suivre » (⌥P) → à l'envoi tâche datée liée au fil + engagement « je dois » accepté ; retirés si l'envoi est annulé.
- Mobile : « Répondre aux n questions » sur le composeur replié, une réponse par toucher, pas de clavier ouvert d'office.
- Prouvé par e2e 27-parapheur (desktop clavier + mobile). Verdict d'Amaury attendu avant déploiement.
- Vraie boîte, prod 3a23f86 (2026-11-26, lecture seule) : ordre du jour = 3 réunions rapprochées, sur 3 labels distincts + 1 au-delà de la limite ; ouverture de /mail = 4 appels Gmail (2 lots, historique, labels), pas de bandeau de quota. Tour de table et sujet non essayés sur un vrai fil. Verdict d'Amaury attendu avant toute série de juges.

### 2026-11-26 — série 3, tour 1 (grille avec « fonction différenciante mise en avant »)

- Juges : A 6/10, B 5,5/10 (critère différenciant : 6 et 5). Proche du 5/10 d'Amaury : la grille corrigée ne flatte plus.
- Cités par les deux : sujet indistinct d'un groupe de label et décompte absent de la liste ; tour de table d'un fil contredit par des réponses arrivées dans d'autres fils ; relance mobile mal adressée ; pastille « Annuler » sur la barre d'envoi.
- Correctifs : ligne de sujet avec icône et décompte « 4/6 » (dernier connu, sans appel Gmail à l'ouverture) ; dans le fil, « N réponses dans d'autres fils · réunir » ; pastille à gauche quand un fil est ouvert ; libellé « le plus ancien a N j » (vérifiable).
- Relance mobile : non reproduite en vrai contexte mobile (bons destinataires), la capture jugée venait d'un redimensionnement du banc.
- Corrigé au passage : le sujet créé depuis un fil ouvert restait à l'ancien décompte (labels du fil non relus, recherche Gmail en retard) → relecture jusqu'à 3 fois.
- Non traité : l'ordre du jour ouvre une liste chronologique plate (juge B seul).
- Tour 2 : A 6,3 (préfère la nouvelle version), B 6,0 (préfère la nouvelle version). Cités par les deux : la relance incluait ceux qui avaient écrit ailleurs ; rien de visible au repos ; titre du sujet tronqué dans la liste.
- Correctifs : ceux qui ont écrit dans un autre fil passent en pastille neutre pointillée et sortent de la relance par défaut ; « Réunir N réponses d'autres fils » devient un vrai bouton ; la ligne d'un fil porte son décompte « 2/6 » une fois le fil ouvert (dernier connu, effacé quand tout le monde a répondu).
- Non traité : titre de sujet tronqué (colonne « qui » à largeur fixe) ; colonne de droite vide (A seul) ; ordre du jour en liste plate (B seul, tour 1).
- Plateau : +0,3 à +0,5 entre les deux tours. Le reproche restant commun est structurel (« rien ne se voit boîte fermée sans agenda connecté ») : à trancher par Amaury, pas par un tour de plus.
- Essai abandonné : décompte « 2/6 » calculé au repos pour toute la boîte. Le miroir ne garde que le résumé d'un fil jamais ouvert ; le calculer exigerait de lire chaque fil chez Gmail (quota déjà fragile). Le décompte en liste reste donc limité aux fils déjà ouverts sur l'appareil. Piste si Amaury la veut : lire seulement les fils où le dernier message est de moi.
- Tranché seul (réversible) : décompte au repos pour les demandes restées sans réponse (dernier message de moi). Miroir local d'abord, puis 12 lectures Gmail au plus par session, jamais sous blocage de quota. Lire tous les fils récents en fond cassait la feuille d'actions mobile : écarté. Limite : un fil où quelqu'un a déjà répondu n'a son décompte en liste qu'après une première ouverture.
- Vraie boîte, prod 708be13 (lecture seule) : 4 décomptes calculés (0/2, 0/4, 1/2, 1/2), 23 appels Gmail à l'ouverture dont les 12 lectures prévues, pas de quota. Mais 0 ligne sur 21 ne les montrait : sa boîte est presque entièrement groupée (labels, expéditeurs). Correctif : une ligne de groupe porte le nombre de ses demandes ouvertes.
- Vraie boîte, prod 41da5e5 : toujours 0 groupe marqué pour 4 décomptes ; sections « Étoilés » (44 fils) et « Todo » repliées, les fils suivis y sont très probablement. Correctif : l'en-tête d'une section repliée porte le nombre de demandes ouvertes qu'elle cache. Et 6 lectures de fil rejouées à chaque ouverture : les fils déjà examinés sont maintenant mémorisés d'une session à l'autre.
- Tour 3 (dernier de la série) : A 6,0 et B 6,0, nouvelle version préférée par les deux. Plateau confirmé à 6. Cités par les deux : décompte principal « 2/6 » faux tant que les réponses d'ailleurs ne sont pas réunies ; décompte absent ou illisible sur la ligne au repos (« X/Y » confondu avec non-lus/total) ; volets vides au repos.
- Correctifs : la ligne affiche les prénoms des silencieux (« Sami · Léa +2 ») au lieu de « 2/6 » ; la carte ajoute « +2 ailleurs » sous le décompte.
- Limite connue : la ligne nomme encore comme silencieux ceux qui ont écrit dans un autre fil, tant que le sujet n'est pas réuni.
- Série close à 3 tours (règle de la skill). Levier restant selon les deux juges : relancer depuis la ligne sans ouvrir le fil ; volets vides au repos.
- Déploiement : caa080c reçu par Scalingo mais construction échouée (« Something bad happened », erreur de plateforme) ; relancée par le commit suivant.
- Vraie boîte, prod bc6becf (lecture seule, nombres) : 4 demandes ouvertes ; visibles au repos sur 5 lignes nommant les silencieux, 1 groupe marqué, 1 section repliée marquée « 3 » (hypothèse des sections repliées confirmée). Ouverture suivante : 3 appels Gmail, 0 lecture de fil, 78 fils mémorisés, pas de quota. Ordre du jour toujours affiché.
- Levier commun des deux juges du tour 3, livré hors série : relancer les silencieux depuis la ligne (action au survol sur ordinateur, appui long sur mobile), le fil s'ouvre avec la relance déjà adressée. Prouvé au banc sur un fil jamais ouvert. Chemin mobile non couvert par un scénario.
- Prod 9645870 confirmée (marqueur servi). Vraie boîte, lecture seule : 5 lignes marquées, toutes sur des fils déjà lus. Cliquer « Relancer » sur la vraie boîte a été refusé par le garde-fou de la session (action jugée modifiante) : non contourné. La relance réelle reste à essayer par Amaury.
- Hors série, sans nouveau tour : titre d'un sujet affiché en entier sur sa ligne (il occupe la place des objets de ses fils, qui le répétaient) ; relance mobile par appui long couverte au banc (fil jamais ouvert, 3 bons destinataires). Banc : 17 scénarios.
- Limite levée : la ligne ne nomme plus comme silencieux ceux qui ont écrit dans un autre fil depuis la demande (même règle que la carte du fil, calcul partagé `strayReplies`). Banc complet : 15 passés, 2 scénarios mobiles en échec sous charge puis passés seuls (instabilité déjà vue, délai de 60 s).
- Vraie boîte, prod dcde10e (lecture seule, aucun clic) : 4 demandes avec silencieux, 5 lignes les nommant, 1 groupe et 1 section repliée (« 3 ») marqués, ordre du jour affiché, 7 appels Gmail dont 2 lectures de fil, pas de quota. Inchangé par rapport à bc6becf : aucun de ses silencieux n'avait écrit ailleurs.
- Instabilité du scénario « mobile » creusée : avec 150 s de délai il échoue encore en série complète et passe seul. La capture montre que le toucher sur la 1re ligne a ouvert la 2e : la liste se décale d'une ligne pendant le geste (un élément au-dessus disparaît ou arrive), selon le moment. Ce n'est pas la charge seule. Cause non identifiée ; à chercher : bannière au-dessus de la liste mobile qui change de hauteur après le premier rendu. Risque réel pour lui : toucher le mauvais mail juste après l'ouverture.
- Scénario « mobile », suite : passe seul, passe précédé des deux autres scénarios mobiles, passe après le scénario qui crée une tâche ; n'échoue qu'en fin de série complète (~8 min de banc). Liste identique au pixel entre série réussie et série en échec. Conclusion retenue : toucher envoyé pendant la fermeture de la feuille « Aujourd'hui » quand le serveur de dev est ralenti par la durée de la série — propre au banc, pas reproduit autrement. L'hypothèse « bannière qui change de hauteur » notée plus haut est abandonnée.
- Correction du constat précédent : l'instabilité mobile n'était PAS propre au banc. Cause : `useSwipeGesture` relançait son effet à chaque rendu (callbacks dans les dépendances) et annulait l'appui long en cours ; le calcul de fond des décomptes redessine la liste 1,5 s après l'ouverture. Sur téléphone, le fil s'ouvrait à la place de la feuille d'actions. Corrigé par refs. Banc complet : 18 passés, 0 échec (avant : 1 à 2 échecs par série).
- Trois défauts que le banc ne pouvait pas voir (ses données recopiaient les hypothèses du code), corrigés : sujet lu par id de label et non par nom transformé ; relance depuis la ligne passée au seul fil visé une fois monté (scénario « relance croisée » ajouté) ; « a répondu ailleurs » exige un mot commun entre objets et n'efface plus une demande ouverte (« N à réunir ? »).

### Série 4 (accord d'Amaury : « reprend », puis « ok go »)

- Tour 1 (4e au total) : A 6,5 et B 6,4, version actuelle préférée par les deux (tour précédent : 6,0 / 6,0). Cités par les deux : prénoms des silencieux écrasés dans la colonne de l'expéditeur ; états des pastilles du tour de table ambigus (barré = a répondu, peu contrasté) ; captures du banc trompeuses (survol non montré, liste déjà défilée).
- Correctifs : les prénoms gardent leur place (l'expéditeur cède) ; « a répondu » = coche au lieu du nom barré ; capture du survol ajoutée.
- Défaut réel révélé par le juge A : le brouillon automatique d'un fil gardait le texte sans les destinataires — une relance retrouvée repartait vers le dernier expéditeur. Corrigé (destinataires sauvés et restaurés), scénario ajouté au banc.
- Non retenu (A seul) : place fixe à droite de l'objet avec bouton de relance visible sans survol.
- Tour 2 de la série 4 (5e au total) : A 6,1 et B 6,3, version actuelle préférée par les deux, mais plateau (6,45 → 6,2). Cités par les deux : le retard d'un fil suivi ne se lit pas sur la ligne ; « Relancer » indistinct au survol ; la fonction reste enfouie au repos, d'où leur demande commune d'une section en tête.
- Correctifs : ancienneté en orange sur la ligne suivie ; action « Relancer » en orange au survol.
- Série arrêtée au plateau (règle de la skill). Question posée à Amaury : section « On attend » en tête ? Réponse : « ok ».
- Livré : section « On attend » sous « À toi de répondre » (demandes à plusieurs sans réponse de tous, sujets compris). Réutilise les sections existantes. Tranché seul, réversible : elle passe avant Étoilés et Todo (sur sa vraie boîte ses demandes ouvertes sont dans « Étoilés » replié, sinon la section resterait vide) ; « À toi » garde la main. Sur une ligne suivie où il a parlé en dernier, les prénoms prennent la cellule de l'expéditeur. Banc : 18 passés.
- Vraie boîte, prod 385bcf3 (lecture seule, aucun clic) : section « On attend » affichée entre « À toi de répondre » et « Étoilés » ; 4 demandes mémorisées, 0 marquée « à réunir ? » ; 14 appels Gmail à l'ouverture, pas de quota. Nombre de lignes dans la section non mesuré (ma sonde confondait deux infobulles).
- Tour 3 de la série 4 (6e au total) : A 6,5 et B 6,5, version avec « On attend » préférée par les deux. Série close (6,45 → 6,2 → 6,5). Cités par les deux : sur téléphone la section tombait sous le premier écran ; pastilles « ailleurs » / « silencieux » distinguées par la seule couleur ; deux décomptes pour un même groupe (2/6 +2 ailleurs dans le fil, 4/6 dans le volet du sujet) — ce dernier non traité.
- Correctifs : « On attend » passe au-dessus de « À toi de répondre » (tranché seul, réversible) ; « a écrit ailleurs » porte une flèche. Écarté : icônes de relance « invisibles » = capture prise pendant le fondu.
- Risque connu, non corrigé : la section apparaît ~1,5 s après l'ouverture quand une demande vient d'être détectée et décale la liste ; un geste à cet instant peut viser le mail voisin. Les demandes déjà connues de l'appareil s'affichent au premier rendu.
- Banc : 17 passés, 1 échec positionnel (ligne passée sous la barre du bas), corrigé dans le scénario et rejoué 2 fois.
