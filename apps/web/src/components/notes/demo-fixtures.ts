/**
 * Demo fixtures for notes — used by the "Charger des exemples (démo)" button in Settings > Backup.
 * These are NOT loaded by default. The app starts empty.
 */
import type { Note, Folder } from "./fixtures";

export const DEMO_FOLDERS: Folder[] = [
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

export const DEMO_NOTES: Note[] = [
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
    title: "Projet — Brief produit",
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
];
