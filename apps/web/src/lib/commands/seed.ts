import type { Command } from "./types";

/**
 * Seed commands registered at app startup.
 * Actual implementations are stubs until tRPC is wired up.
 */
export const SEED_COMMANDS: Command[] = [
  // ---- Creation -----------------------------------------------------------
  {
    id: "note.create",
    label: "Nouvelle note",
    description: "Créer une nouvelle note vide dans l'Inbox",
    icon: "file-plus",
    shortcut: "mod+n",
    group: "creation",
    keywords: ["new", "note", "create", "ajouter"],
    run: () => {
      // TODO: wire to tRPC entities.create
      console.info("[seed] note.create triggered — toast placeholder");
    },
  },
  {
    id: "note.create-daily",
    label: "Note du jour",
    description: "Ouvrir ou créer la note quotidienne (Daily)",
    icon: "calendar",
    shortcut: "mod+d",
    group: "creation",
    keywords: ["daily", "journal", "today", "aujourd'hui"],
    run: () => {
      console.info("[seed] note.create-daily triggered — toast placeholder");
    },
  },

  // ---- Navigation ---------------------------------------------------------
  {
    id: "nav.notes",
    label: "Aller aux Notes",
    icon: "file-text",
    shortcut: undefined,
    group: "navigation",
    keywords: ["notes", "liste"],
    run: () => {
      console.info("[seed] nav.notes — router.push('/notes')");
    },
  },
  {
    id: "nav.contacts",
    label: "Aller aux Contacts",
    icon: "users",
    group: "navigation",
    keywords: ["contacts", "personnes", "crm"],
    run: () => {
      console.info("[seed] nav.contacts — router.push('/contacts')");
    },
  },
  {
    id: "nav.projects",
    label: "Aller aux Projets",
    icon: "layers",
    group: "navigation",
    keywords: ["projets", "projects"],
    run: () => {
      console.info("[seed] nav.projects — router.push('/projects')");
    },
  },
  {
    id: "nav.routines",
    label: "Aller aux Routines",
    icon: "zap",
    group: "navigation",
    keywords: ["routines", "automations"],
    run: () => {
      console.info("[seed] nav.routines — router.push('/routines')");
    },
  },
  {
    id: "nav.schemas",
    label: "Aller aux Schémas",
    icon: "hash",
    group: "navigation",
    keywords: ["schemas", "types", "entités"],
    run: () => {
      console.info("[seed] nav.schemas — router.push('/schemas')");
    },
  },
  {
    id: "nav.settings",
    label: "Paramètres",
    icon: "settings",
    shortcut: "mod+,",
    group: "navigation",
    keywords: ["settings", "preferences", "paramètres"],
    run: () => {
      console.info("[seed] nav.settings — router.push('/settings')");
    },
  },

  // ---- View ---------------------------------------------------------------
  {
    id: "view.toggle-sidebar",
    label: "Afficher / Masquer la barre latérale",
    icon: "panel-left",
    group: "view",
    keywords: ["sidebar", "toggle", "panel", "barre"],
    run: () => {
      console.info("[seed] view.toggle-sidebar");
    },
  },
  {
    id: "view.toggle-right-panel",
    label: "Afficher / Masquer le panneau droit",
    icon: "panel-right",
    group: "view",
    keywords: ["right panel", "panneau", "context"],
    run: () => {
      console.info("[seed] view.toggle-right-panel");
    },
  },
  {
    id: "view.toggle-theme",
    label: "Basculer thème clair / sombre",
    icon: "sun",
    group: "view",
    keywords: ["theme", "dark", "light", "sombre", "clair"],
    run: () => {
      console.info("[seed] view.toggle-theme");
    },
  },

  // ---- Search / Tools -----------------------------------------------------
  {
    id: "search.open",
    label: "Recherche globale",
    description: "Recherche full-text dans tout le vault",
    icon: "search",
    shortcut: "mod+shift+f",
    group: "tools",
    keywords: ["search", "find", "recherche", "fts"],
    run: () => {
      console.info("[seed] search.open — open full search panel");
    },
  },
];
