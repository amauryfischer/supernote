import type { Command } from "./types";

export interface SeedCommandDeps {
  /** Navigation SPA (react-router) — évite le reboot worker de window.location. */
  navigate: (to: string) => void;
  /** Bascule thème clair ↔ sombre. */
  toggleTheme: () => void;
  /** Affiche/masque le panneau droit (event → shell-chrome-context). */
  toggleRightPanel: () => void;
  /** Date du jour ISO (yyyy-mm-dd) pour la note quotidienne. */
  today: string;
}

/**
 * Construit les commandes de la palette avec de vraies actions liées au contexte
 * React (navigation SPA, thème, chrome). Avant, `SEED_COMMANDS` était statique et
 * 10/13 `run` n'étaient que des `console.info` (un module ne peut pas appeler les
 * hooks) : la palette — pourtant vendue comme hub par l'onboarding — ne faisait
 * rien. Câblé depuis CommandSurface.
 */
export function buildSeedCommands(deps: SeedCommandDeps): Command[] {
  const { navigate, toggleTheme, toggleRightPanel, today } = deps;
  return [
    // ---- Création ----------------------------------------------------------
    {
      id: "note.create",
      label: "Nouvelle note",
      description: "Créer une nouvelle note vide dans l'Inbox",
      icon: "file-plus",
      shortcut: "mod+n",
      group: "creation",
      keywords: ["new", "note", "create", "ajouter"],
      run: () => navigate("/?new=true"),
    },
    {
      id: "note.create-daily",
      label: "Note du jour",
      description: "Ouvrir la note quotidienne (journal)",
      icon: "calendar",
      group: "creation",
      keywords: ["daily", "journal", "today", "aujourd'hui"],
      run: () => navigate(today ? `/journal/${today}` : "/journal"),
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

/**
 * Liste statique (métadonnées) — pour les surfaces qui n'affichent que le
 * catalogue (ex. page /command-demo). Les `run` sont inertes ; les vraies
 * actions viennent de `buildSeedCommands` câblé dans CommandSurface.
 */
export const SEED_COMMANDS: Command[] = buildSeedCommands({
  navigate: () => {},
  toggleTheme: () => {},
  toggleRightPanel: () => {},
  today: "",
});
