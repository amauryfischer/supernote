import type { Command } from "./types";

export interface SeedCommandDeps {
  /** Navigation SPA (react-router) — évite le reboot worker de window.location. */
  navigate: (to: string) => void;
  /** Bascule thème clair ↔ sombre. */
  toggleTheme: () => void;
  /** Affiche/masque le panneau droit (event → shell-chrome-context). */
  toggleRightPanel: () => void;
  /** Crée une note vierge dans l'Inbox et l'ouvre. */
  newNote: () => void;
  /** Ouvre le choix du modèle, puis crée la note. */
  newNoteFromTemplate: () => void;
}

/**
 * Commandes de la palette, liées au contexte React (navigation SPA, thème,
 * chrome) : un module ne peut pas appeler les hooks. Câblé depuis CommandSurface.
 */
export function buildSeedCommands(deps: SeedCommandDeps): Command[] {
  const { navigate, toggleTheme, toggleRightPanel, newNote, newNoteFromTemplate } = deps;
  return [
    // ---- Création ----------------------------------------------------------
    {
      id: "note.create",
      label: "Nouvelle note",
      description: "Créer une nouvelle note vide dans l'Inbox",
      icon: "file-plus",
      shortcut: "mod+alt+c",
      group: "creation",
      keywords: ["new", "note", "create", "ajouter", "capture", "rapide", "inbox", "noter"],
      run: newNote,
    },
    {
      id: "note.create-from-template",
      label: "Nouvelle note depuis un modèle",
      description: "Choisir un modèle, répondre à ses questions, ouvrir la note",
      icon: "file-plus",
      group: "creation",
      keywords: ["modèle", "modele", "template", "gabarit", "new", "note", "créer"],
      run: newNoteFromTemplate,
    },

    // ---- Navigation --------------------------------------------------------
    {
      id: "nav.notes",
      label: "Aller aux Notes",
      icon: "file-text",
      group: "navigation",
      keywords: ["notes", "liste"],
      run: () => navigate("/notes"),
    },
    {
      id: "nav.contacts",
      label: "Aller aux Contacts",
      icon: "users",
      group: "navigation",
      keywords: ["contacts", "personnes", "crm"],
      run: () => navigate("/contacts"),
    },
    {
      id: "nav.habits",
      label: "Aller aux Habitudes",
      icon: "grid",
      group: "navigation",
      keywords: ["habitudes", "habits", "tracker", "pixels", "streak"],
      run: () => navigate("/habits"),
    },
    {
      id: "nav.routines",
      label: "Aller aux Routines",
      icon: "zap",
      group: "navigation",
      keywords: ["routines", "automations"],
      run: () => navigate("/routines"),
    },
    {
      id: "nav.schemas",
      label: "Aller aux Schémas",
      icon: "hash",
      group: "navigation",
      keywords: ["schemas", "types", "entités"],
      run: () => navigate("/schemas"),
    },
    {
      id: "nav.templates",
      label: "Aller aux Modèles",
      icon: "file-text",
      group: "navigation",
      keywords: ["modèles", "modeles", "templates", "gabarits"],
      run: () => navigate("/templates"),
    },
    {
      id: "nav.settings",
      label: "Paramètres",
      icon: "settings",
      shortcut: "mod+,",
      group: "navigation",
      keywords: ["settings", "preferences", "paramètres"],
      run: () => navigate("/parametres"),
    },

    // ---- Affichage ---------------------------------------------------------
    {
      id: "view.toggle-right-panel",
      label: "Afficher / Masquer le panneau droit",
      icon: "panel-right",
      group: "view",
      keywords: ["right panel", "panneau", "context"],
      run: () => toggleRightPanel(),
    },
    {
      id: "view.toggle-theme",
      label: "Basculer thème clair / sombre",
      icon: "sun",
      group: "view",
      keywords: ["theme", "dark", "light", "sombre", "clair"],
      run: () => toggleTheme(),
    },

    // ---- Recherche ---------------------------------------------------------
    {
      id: "search.open",
      label: "Recherche globale",
      description: "Recherche full-text dans tout le vault",
      icon: "search",
      shortcut: "mod+shift+f",
      group: "tools",
      keywords: ["search", "find", "recherche", "fts"],
      run: () => navigate("/recherche"),
    },
  ];
}
