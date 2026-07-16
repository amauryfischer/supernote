# Product

## Register

product

## Platform

web

## Users

Une seule personne, pouvoir : l'utilisateur qui gère sa vie de connaissance avec ses propres outils et refuse de la disperser dans cinq SaaS. Il tient déjà des notes, un carnet de contacts, des projets et un suivi financier — aujourd'hui éclatés entre un éditeur, un gestionnaire de tâches, un tableur et un CRM. Il est à l'aise techniquement, exigeant sur la latence et la propriété de ses données, et travaille surtout au clavier. Son contexte d'usage est quotidien et prolongé : c'est un espace de travail où il reste, pas une app qu'on ouvre puis referme. Le succès, c'est qu'il cesse de jongler entre applications et qu'une pensée, un contact ou un chiffre saisi une fois devienne immédiatement relié et requêtable partout.

## Product Purpose

Supernote est un espace de travail personnel local-first qui réunit notes, bases de données, CRM et finances dans une seule surface cohérente. Tout vit sur le disque de l'utilisateur en markdown lisible, versionné en git, sans serveur ni abonnement ni télémétrie. La raison d'être : supprimer les frontières entre les silos habituels — une note peut mentionner un contact, une base peut piloter un projet, une entité financière peut apparaître dans un dashboard — pour que l'information saisie une fois soit connectée et interrogeable dans toutes les vues (table, kanban, galerie, calendrier, graphe). Le produit réussit quand l'utilisateur oublie qu'il utilisait autrefois quatre applications distinctes.

## Positioning

L'atelier de vie unique : le seul espace qui remplace Notion, Obsidian, un CRM et un tableur finance à la fois — sans jongler entre applications, et sans jamais quitter ta machine. Chaque écran doit rappeler qu'ici tout est relié et que rien ne part dans le cloud.

## Brand Personality

Calme et concentré, précis et expert. L'interface est sobre et laisse respirer le contenu — c'est un instrument de travail qui s'efface derrière la tâche, pas une vitrine. Mais sous ce calme, la puissance est assumée : formules, requêtes, backlinks, relations typées sont exposés avec la confiance tranquille d'un pro-tool (registre Linear / Coda), sans intimider ni tapager. La voix est directe, française, sans jargon marketing. La densité n'est jamais fuie quand l'utilisateur en a besoin ; elle est simplement révélée au bon moment.

## Anti-references

Deux repoussoirs précis. **Notion tiède et gris** : le gris plat de bout en bout, où chaque surface se ressemble, où rien n'a d'identité et où l'ensemble finit froid. **Le SaaS générique** : grilles de cartes identiques (icône + titre + texte répétés), dégradés décoratifs, eyebrow tracké en majuscules au-dessus de chaque section, chiffres héro clinquants. Supernote n'est ni une plaquette ni un template — c'est un outil habité.

## Design Principles

L'outil disparaît dans la tâche. Le calme et le vide sont un choix de conception, pas un manque : on n'ajoute une couleur, une ombre ou un mouvement que s'il porte un état ou une action.

Un seul espace, une seule grammaire. Notes, bases, CRM et finances partagent le même vocabulaire de composants, les mêmes affordances, le même feel de mouvement. Changer de surface ne doit jamais obliger à réapprendre l'interface.

Confiance d'expert par révélation progressive. La pleine puissance (formules, requêtes, relations) reste accessible mais ne s'impose pas d'emblée : le débutant voit une surface simple, l'expert atteint la profondeur sans détour.

Local-first, et ça se ressent. Instantané, réversible, à soi. Aucune latence de réseau, aucun spinner d'attente distante, aucune froideur de service tiers ne doit transparaître dans l'expérience.

Le clavier d'abord. Toute action est atteignable sans souris ; la command palette et les raccourcis sont des citoyens de première classe, pas un bonus.

## Accessibility & Inclusion

Priorité explicite : navigation clavier complète de bout en bout — chaque action atteignable au clavier, command palette et raccourcis documentés comme chemin principal, jamais un simple accélérateur. Deux garde-fous sont déjà en place dans le code et doivent le rester comme socle : les anneaux de focus visibles (`:focus-visible` sur token accent) et le kill-switch `prefers-reduced-motion` global qui neutralise toute transition/animation. À maintenir à chaque nouvelle surface.
