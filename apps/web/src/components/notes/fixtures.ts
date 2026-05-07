export interface Note {
  id: string;
  title: string;
  body: string;
  folderPath: string;
  updatedAt: string;
  tags: string[];
}

export interface Folder {
  name: string;
  path: string;
  children?: Folder[];
}

export const FOLDERS: Folder[] = [
  {
    name: "Inbox",
    path: "Inbox",
  },
  {
    name: "Notes",
    path: "Notes",
    children: [
      { name: "Projets", path: "Notes/Projets" },
      { name: "Ressources", path: "Notes/Ressources" },
    ],
  },
  {
    name: "Daily",
    path: "Daily",
  },
];

export const NOTES: Note[] = [
  {
    id: "1",
    title: "Réunion Q2 — Résumé",
    body: "Objectifs du trimestre validés. Budget marketing augmenté de 15%. L'équipe produit présente la roadmap Q3 la semaine prochaine. Points d'action : contacter Jean avant vendredi.",
    folderPath: "Inbox",
    updatedAt: "2026-05-07T10:30:00Z",
    tags: ["réunion", "Q2"],
  },
  {
    id: "2",
    title: "Idées pour le blog",
    body: "Sujets potentiels : notion de second cerveau, outils de PKM, pourquoi le markdown gagne, comparatif Obsidian vs Roam. Penser à la série sur la productivité.",
    folderPath: "Inbox",
    updatedAt: "2026-05-06T16:45:00Z",
    tags: ["blog", "idées"],
  },
  {
    id: "3",
    title: "Courses à faire",
    body: "Pain, lait, café éthiopien (Cafés Richard), yaourts nature. Ne pas oublier le vin pour le dîner de samedi.",
    folderPath: "Inbox",
    updatedAt: "2026-05-06T09:00:00Z",
    tags: [],
  },
  {
    id: "4",
    title: "Lecture : Deep Work",
    body: "Cal Newport définit le travail profond comme la capacité à se concentrer sans distraction sur une tâche cognitivement exigeante. Concept clé : la règle du 4-6h de concentration quotidienne.",
    folderPath: "Inbox",
    updatedAt: "2026-05-05T20:15:00Z",
    tags: ["lecture", "productivité"],
  },
  {
    id: "5",
    title: "Architecture Supernote",
    body: "Monorepo Turborepo. Apps : web (Next.js 15), desktop (Electron). Packages : editor (BlockNote), core (logique métier), ipc (bridge Electron). Pattern vault-first : toutes les données sont des fichiers markdown locaux.",
    folderPath: "Notes",
    updatedAt: "2026-05-07T09:00:00Z",
    tags: ["dev", "architecture"],
  },
  {
    id: "6",
    title: "Ressources TypeScript avancé",
    body: "Matt Pocock - Total TypeScript. Type challenges sur GitHub. Livre : Programming TypeScript de Boris Cherny. Penser aux mapped types et conditional types.",
    folderPath: "Notes",
    updatedAt: "2026-05-06T14:00:00Z",
    tags: ["typescript", "apprentissage"],
  },
  {
    id: "7",
    title: "Falcon — Brief produit",
    body: "Application de gestion de notes d'équipe. Cible : équipes de 5-50 personnes. Fonctionnalités core : wiki collaboratif, notes personnelles, intégrations Slack/GitHub. MVP en 3 mois.",
    folderPath: "Notes/Projets",
    updatedAt: "2026-05-07T08:30:00Z",
    tags: ["projet", "produit"],
  },
  {
    id: "8",
    title: "Design system tokens",
    body: "Couleurs : violet oklch(0.55 0.24 295). Surfaces : de 0.995 à 0.940. Textes : primary/secondary/muted. Rayons : sm 4px, md 6px, lg 10px, xl 14px.",
    folderPath: "Notes/Ressources",
    updatedAt: "2026-05-05T11:00:00Z",
    tags: ["design", "tokens"],
  },
  {
    id: "9",
    title: "Commandes Git utiles",
    body: "git rebase -i HEAD~3 pour squash. git stash pop --index pour restaurer les fichiers stagés. git log --oneline --graph --all pour visualiser l'arbre.",
    folderPath: "Notes/Ressources",
    updatedAt: "2026-05-04T17:30:00Z",
    tags: ["git", "dev"],
  },
  {
    id: "10",
    title: "Veille IA — Mai 2026",
    body: "Claude 4 toujours en tête sur les tâches de code. GPT-5 très fort sur le raisonnement multimodal. Gemini 2.5 Ultra excelle sur la fenêtre de contexte étendue.",
    folderPath: "Notes",
    updatedAt: "2026-05-07T07:00:00Z",
    tags: ["IA", "veille"],
  },
  {
    id: "11",
    title: "Daily 2026-05-07",
    body: "Matin : réunion équipe 9h. Priorité 1 : finir la page notes. Priorité 2 : review PR editor. Soir : appel avec Marie. Humeur : focalisé, bonne énergie.",
    folderPath: "Daily",
    updatedAt: "2026-05-07T08:00:00Z",
    tags: ["daily"],
  },
  {
    id: "12",
    title: "Daily 2026-05-06",
    body: "Journée productive. Avancé sur l'architecture des composants notes. Lu 40 pages de Deep Work le soir. Points bloquants : intégration tRPC à finaliser.",
    folderPath: "Daily",
    updatedAt: "2026-05-06T22:00:00Z",
    tags: ["daily"],
  },
  {
    id: "13",
    title: "Daily 2026-05-05",
    body: "Sprint planning. Nouvelles stories estimées. Vitesse équipe : 34 points. Focus sur la qualité plutôt que la quantité. Rétrospective vendredi.",
    folderPath: "Daily",
    updatedAt: "2026-05-05T21:30:00Z",
    tags: ["daily"],
  },
  {
    id: "14",
    title: "Daily 2026-05-04",
    body: "Débogage du système de virtualisation de liste. Problème résolu : hauteur fixe vs dynamique. Merged 2 PRs. Lu article sur les patterns React Server Components.",
    folderPath: "Daily",
    updatedAt: "2026-05-04T21:00:00Z",
    tags: ["daily"],
  },
  {
    id: "15",
    title: "Daily 2026-05-03",
    body: "Week-end de travail intense. Prototypé le file tree récursif. Choix tech : useState + callbacks plutôt que Zustand pour rester simple. Bonne session.",
    folderPath: "Daily",
    updatedAt: "2026-05-03T18:00:00Z",
    tags: ["daily"],
  },
  {
    id: "16",
    title: "Shortcodes Tailwind v4",
    body: "Plus de tailwind.config.js — tout passe par @theme dans globals.css. Les custom properties CSS sont automatiquement disponibles comme utilities. Inline styles pour les oklch custom.",
    folderPath: "Notes/Ressources",
    updatedAt: "2026-05-03T14:00:00Z",
    tags: ["tailwind", "dev"],
  },
  {
    id: "17",
    title: "Contacts à relancer",
    body: "Pierre Martin (Investissement) : follow-up après pitch. Sophie Durand (Design) : collaborer sur le design system. Thomas Leclerc (Dev) : potentiellement intéressé par le projet.",
    folderPath: "Inbox",
    updatedAt: "2026-05-02T10:00:00Z",
    tags: ["contacts", "relance"],
  },
  {
    id: "18",
    title: "Raccourcis clavier Supernote",
    body: "Cmd+K : palette de commandes. Cmd+P : recherche rapide. Cmd+N : nouvelle note. Cmd+Shift+F : mode focus. Cmd+\\ : toggle sidebar.",
    folderPath: "Notes/Ressources",
    updatedAt: "2026-05-01T16:00:00Z",
    tags: ["raccourcis", "productivity"],
  },
  {
    id: "19",
    title: "Recette : risotto champignons",
    body: "300g riz arborio, 200g champignons, 1 échalote, 150ml vin blanc, 1L bouillon chaud. Faire suer l'échalote, nacrer le riz, déglacer au vin, ajouter le bouillon louche par louche.",
    folderPath: "Inbox",
    updatedAt: "2026-04-30T19:00:00Z",
    tags: ["recette", "cuisine"],
  },
  {
    id: "20",
    title: "Notes conf LocalFirst 2026",
    body: "CRDTs vs OT : Automerge v3 stable, Yjs très populaire. Tendance : edge sync + offline-first PWA. Talk de Martin Kleppmann sur les conflits de merge dans les éditeurs.",
    folderPath: "Notes",
    updatedAt: "2026-04-28T18:00:00Z",
    tags: ["conf", "local-first"],
  },
];

export function getNotesForFolder(folderPath: string): Note[] {
  return NOTES.filter((n) => n.folderPath === folderPath);
}

export function getNoteById(id: string): Note | undefined {
  return NOTES.find((n) => n.id === id);
}

export function formatRelativeDate(isoDate: string): string {
  const date = new Date(isoDate);
  const now = new Date("2026-05-07T12:00:00Z");
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return "Aujourd'hui";
  if (diffDays === 1) return "Hier";
  if (diffDays < 7) return `Il y a ${diffDays} jours`;
  return date.toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
}
