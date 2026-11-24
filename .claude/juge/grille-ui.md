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
