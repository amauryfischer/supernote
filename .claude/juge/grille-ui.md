# Grille UI — Supernote

Référence de comparaison : Linear, Superhuman, Shortwave. Cible 9/10.

| Critère | Poids | Ce qui est regardé | Échec si |
|---|---|---|---|
| Caractère | 25 % | L'écran a une identité reconnaissable (matière, lumière, élément-signature), pas un gabarit générique | on pourrait le confondre avec n'importe quel client mail ; retouches seulement (liseré, pastille) |
| Lisibilité à haute densité | 25 % | 300 mails/jour : on trie à l'œil, hiérarchie expéditeur / objet / état, rien ne se chevauche | texte tronqué ou superposé, colonnes qui dansent, bruit décoratif |
| Information | 20 % | Aucune info perdue ; l'info nouvelle sert une décision (qui attend, depuis quand) | une donnée de l'ancien écran a disparu ; info ajoutée décorative |
| Finition | 15 % | Alignements, rythme vertical, contraste ≥ 4,5:1, états (survol, actif, non-lu, vide), thème sombre | décalage visible, contraste faible, état oublié |
| Mobile | 15 % | Même direction sous 768 px, cibles ≥ 32 px, pas de débordement horizontal | version desktop rétrécie, zone non traitée |

## Goûts durables d'Amaury (tirés des retours passés)

- Registre « console » : dense, mono pour les valeurs, compact. Accent quasi-noir en clair, blanc cassé en sombre.
- Pas de dégradé de couleur en fond de surface (« moche », 2026-10-26) : la teinte est portée par des éléments (glyphes, traits, pastilles).
- Boutons icône + infobulle plutôt que libellés. Pas de toasts.
- Changer la structure se voit ; changer seulement les tokens ne se voit pas (2026-09-03).
- Les juges plafonnent autour de 7,5 sur /mail : son verdict prime.

## Ajout du 2026-11-24 (retours d'Amaury sur /mail)

- « Je m'attendais à une grosse refonte, je ne vois quasi aucun changement » : des retouches de style ne comptent pas. Le critère Caractère échoue si la structure de l'écran n'a pas changé.
- « Plus qu'une boîte email, un outil à mon service » : le critère Information se lit comme **Utilité** — l'écran aide-t-il à décider du destin d'un mail (pour info, à voir avec X, pour telle réunion, à déléguer, note à soi, à répondre) et à agir dessus ?
- « Surprends-moi, audace et caractère, système innovant ». L'IA « je dois / on me doit » se trompe : ce qui est affiché doit être vérifiable.

## Décisions verrouillées (2026-11-24, verdict d'Amaury sur l'aiguillage)

- « L'aiguillage était une mauvaise idée, à supprimer » : note d'Amaury ≈ 2/10, là où les juges donnaient 6,5-6,9 et préféraient chaque nouvelle version. Écart > 4 points : les juges ne voient pas l'utilité réelle.
- Pas de vue « par destin » ni de voies : rien qui re-présente un tri qu'il fait déjà avec ses labels et ses onglets.
- Trois surfaces nouvelles rejetées (Orbite, « À aiguiller », Aiguillage) ; gardées : des actions sur une ligne (« Note à moi », « En tâche, puis ranger »). Un changement se juge à ce test : ajoute-t-il une surface, ou raccourcit-il un geste qu'il fait déjà ?
- Critère Caractère : une surface nouvelle ne rapporte aucun point si elle double une information déjà à l'écran.
- Rien ne s'empile sur une idée qu'il n'a pas vue et validée à l'écran.

## Verdict du 2026-11-25 : 5/10, « il manque une touche wow »

- Écart avec les juges : 6,7 contre 5. Le manque n'est pas de finition : aucune fonction ne fait la différence ni n'est mise en avant.
- Critère ajouté, à juger avant tout autre : **fonction différenciante mise en avant**. L'écran montre-t-il, sans qu'on la cherche, une chose qu'un client mail ne fait pas et qui sert son suivi réel ? Une fonction enfouie dans un menu ne compte pas.
- Demandé par Amaury le 2026-11-26 : ordre du jour des réunions (labels rapprochés de l'agenda) et sujet à plusieurs fils (qui a répondu, qui manque). Ces deux surfaces sont donc validées dans leur principe ; leur exécution reste à juger par lui.
- Garde-fou repris de l'aiguillage : l'ordre du jour n'existe que rattaché à une réunion à venir. Une liste permanente de labels serait l'aiguillage sous un autre nom.
