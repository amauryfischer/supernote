# Product

## Register

product

## Platform

web

## Users

PWA installée, desktop et téléphone au même rang. Une personne, pouvoir : un professionnel dont la journée part de sa boîte mail. Il reçoit des demandes, prend des engagements, cale des rendez-vous, suit des contacts, et refuse de recopier tout ça d'un outil à l'autre. Il est à l'aise techniquement, exigeant sur la latence et la propriété de ses données, travaille au clavier sur son poste et trie au pouce sur son téléphone. C'est un espace où il reste toute la journée, pas une app qu'on ouvre puis referme. Le succès : un mail lu une fois devient tout de suite une tâche, un événement, une note ou une fiche contact, relié et retrouvable partout. Il partage parfois une note ou un fil par lien. Les invités sont des visiteurs, pas des utilisateurs.

## Product Purpose

Supernote est le poste de pilotage quotidien : mail, agenda, tâches, notes, contacts, bases, habitudes et finances dans une seule surface. L'accueil est la boîte mail (`/` redirige vers `/mail`), parce que c'est là que le travail arrive. La raison d'être, c'est le tissu entre ces silos. Un engagement détecté dans un fil propose une tâche ou une relance. Un rendez-vous arrive avec son brief. Un contact porte son dossier vivant : mails, notes, tâches. Une tâche se planifie dans l'agenda. Le produit réussit quand l'utilisateur ne rouvre plus Gmail, Google Agenda ni son gestionnaire de tâches.

## Positioning

Le mail qui débouche sur l'action. Superhuman et Shortwave trient vite mais s'arrêtent à la boîte ; Notion et Coda relient tout mais ignorent le mail. Supernote fait les deux : le triage au clavier d'un client mail expert, et derrière, un coffre relié (todos, agenda, CRM, notes) que les clients mail n'ont pas.

Les données restent à l'utilisateur. Le coffre vit dans le navigateur (SQLite dans un worker, dossier local, git ou salon en ligne). Le seul serveur est le sien : synchro, partage, push. Google reste la source du mail et de l'agenda, recopiés en local. L'IA tourne en local avec Ollama, sans fournisseur tiers.

## Brand Personality

Calme et concentré, précis et expert. L'interface est sobre, registre Linear clair. C'est un instrument de travail qui s'efface derrière la tâche, pas une vitrine. Sous ce calme, la puissance est assumée : raccourcis de triage, formules, requêtes, relations typées, sans intimider ni tapager. La voix est directe, française, sans jargon marketing. La densité n'est jamais fuie quand l'utilisateur en a besoin ; elle est révélée au bon moment.

## Anti-references

**Notion tiède et gris** : le gris plat de bout en bout, où chaque surface se ressemble et où rien n'a d'identité. **Le SaaS générique** : grilles de cartes identiques, dégradés décoratifs, eyebrow en majuscules au-dessus de chaque section, chiffres héros clinquants. **Le client mail qui n'est qu'une boîte** : lire, répondre, archiver, puis recopier ailleurs à la main. Supernote est un outil habité, ni une plaquette ni un template.

## Design Principles

L'outil disparaît dans la tâche. Le calme et le vide sont un choix de conception : on n'ajoute une couleur, une ombre ou un mouvement que s'il porte un état ou une action.

Un seul espace, une seule grammaire. Mail, notes, bases, contacts et agenda partagent les mêmes composants (`@supernote/ui`), les mêmes affordances, le même mouvement. Changer de surface n'oblige jamais à réapprendre l'interface.

Le retour vit dans le geste. Le bouton porte son propre état (chargement, puis coche) ; pas de toast pour confirmer ce qui vient de réussir. Un toast seulement pour une erreur orpheline ou un « Annuler » après une action destructive.

L'IA propose, l'utilisateur dispose. Ce qui est réversible peut être automatique (ranger, étiqueter, avec « Annuler ») ; ce qui crée quelque chose demande confirmation. Quand Ollama est éteint, ça se voit au lieu de faire « ne rien faire ».

Local-first, et ça se ressent. Instantané, réversible, à soi. Pas de spinner d'attente distante : squelette, puis données locales.

Le clavier d'abord sur desktop, le pouce d'abord sur téléphone. Toute action est atteignable sans souris ; toute surface livrée sur desktop l'est aussi sur mobile, dans le même mouvement.

Révélation progressive. La pleine puissance (formules, requêtes, relations) reste accessible sans s'imposer d'emblée.

## Accessibility & Inclusion

Navigation clavier complète de bout en bout : command palette et raccourcis documentés comme chemin principal. Cibles tactiles d'au moins 32 px sur pointeur grossier. Socle à garder à chaque nouvelle surface : anneaux de focus visibles (`:focus-visible` sur token accent), kill-switch `prefers-reduced-motion` global, contraste du texte secondaire ≥ 4.5:1.
