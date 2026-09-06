"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { usePathname } from "next/navigation";
import type { Icon as PhosphorIcon } from "@phosphor-icons/react";
import type { EntityType } from "@supernote/core";
import type { View } from "@supernote/ipc";
import type { AiMarginsStatus, DisplayComment } from "@/hooks/useAiMargins";
import type { NoteBlock } from "@/lib/ai/blockComments";

/**
 * localStorage key for the user's right-panel visibility preference.
 * Persisted so that closing the panel survives a refresh / navigation.
 */
const RIGHT_PANEL_STORAGE_KEY = "supernote.shell.rightPanel";

function readRightPanelPreference(): boolean {
  if (typeof window === "undefined") return true;
  try {
    const raw = window.localStorage.getItem(RIGHT_PANEL_STORAGE_KEY);
    if (raw === null) return true;
    return raw === "true";
  } catch {
    return true;
  }
}

function writeRightPanelPreference(next: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(RIGHT_PANEL_STORAGE_KEY, next ? "true" : "false");
  } catch {
    // ignore quota / disabled-storage errors
  }
}

/**
 * Configuration published by a page to populate the mobile floating action
 * button. `null` hides the FAB. The FAB is rendered above the bottom nav and
 * is the primary affordance for the page's "create" action on phones.
 */
export interface MobileFabConfig {
  /** Phosphor icon component shown inside the circle. */
  icon: PhosphorIcon;
  /** ARIA label / tooltip. */
  label: string;
  /**
   * Click handler. Renvoyer la promesse d'une action asynchrone fait afficher
   * au FAB un état d'attente (icône de progression + bouton verrouillé) le
   * temps de sa résolution ; sans cela, une création lente laisse le bouton
   * parfaitement inerte et l'utilisateur tape à nouveau.
   */
  onPress: () => void | Promise<void>;
}

/**
 * Action button rendered inside the mobile top bar (right side). Pages can
 * publish 0–2 actions; anything beyond is collapsed into a kebab menu by the
 * top bar itself. Common uses: "search", "filter", "save", overflow menu.
 */
export interface MobileHeaderAction {
  /** Stable id used to dedupe between renders. */
  id: string;
  icon: PhosphorIcon;
  label: string;
  onPress: () => void;
  /** Optional badge dot (notification/dirty indicator). */
  active?: boolean;
}

/**
 * Marges IA publiées par la note ouverte, pour que le panneau droit les rende
 * quand la colonne intégrée ne tient pas. Un commentaire de marge doit rester
 * AMBIANT : la feuille modale qui masquait la note détruisait sa raison d'être.
 */
export interface AiMarginsChrome {
  comments: DisplayComment[];
  status: AiMarginsStatus;
  nothingToAnalyze: boolean;
  /** Applique le correctif proposé sur le bloc visé. */
  onApply: (block: NoteBlock, newText: string) => void;
  /** Écarte la suggestion — elle ne revient pas à la passe suivante. */
  onDismiss: (block: NoteBlock) => void;
}

export interface ColumnEditorState {
  base: EntityType;
  view: View;
  /** Field id to open inline-edit on (optional). */
  focusFieldId?: string;
  /** Pre-fill formula expression when opening "new field" inline form. */
  prefillFormula?: { expression: string; outputKind?: "text" | "number" | "date" | "bool" };
}

interface ShellChromeContextValue {
  /** When true, sidebar and right panel dim/collapse so the user can focus on writing. */
  focusMode: boolean;
  setFocusMode: (next: boolean) => void;
  toggleFocusMode: () => void;

  /** Right panel can be hidden by the user (via the X button or topbar toggle). */
  rightPanelVisible: boolean;
  toggleRightPanel: () => void;
  setRightPanelVisible: (next: boolean) => void;

  /**
   * Accent CSS-variable overrides published by deep child routes (e.g. the
   * notes detail page when the selected folder has a custom color). The
   * AppShell merges them into its outermost element style, so sidebar /
   * topbar / right panel inherit the tint along with the editor pane.
   */
  accentOverride: Record<string, string> | null;
  setAccentOverride: (next: Record<string, string> | null) => void;

  /** Bus to ask the home page to focus its writing canvas (e.g. from the topbar "Nouveau" button). */
  requestNewNote: () => void;
  onRequestNewNote: (handler: () => void) => () => void;

  // ── Mobile chrome ─────────────────────────────────────────────────────
  // Mobile-only primitives. The desktop AppShell ignores them; the mobile
  // shell consumes them to populate the top bar and FAB. Pages publish via
  // the small hooks below (`useMobileTitle`, `useMobileFab`,
  // `useMobileHeaderActions`) and clear them on unmount.

  /** Title shown in the mobile top bar. Falls back to a route-derived label. */
  mobileTitle: string | null;
  setMobileTitle: (title: string | null) => void;

  /** Optional subtitle (smaller text under the title — e.g. count, date). */
  mobileSubtitle: string | null;
  setMobileSubtitle: (subtitle: string | null) => void;

  /** Floating action button config. `null` hides the FAB. */
  mobileFab: MobileFabConfig | null;
  setMobileFab: (config: MobileFabConfig | null) => void;

  /** Header action buttons (right side of the mobile top bar). */
  mobileHeaderActions: MobileHeaderAction[];
  setMobileHeaderActions: (actions: MobileHeaderAction[]) => void;

  /** Column editor sidebar — quand non-null, la sidebar s'affiche à droite. */
  columnEditor: ColumnEditorState | null;
  openColumnEditor: (base: EntityType, view: View, opts?: { focusFieldId?: string; prefillFormula?: ColumnEditorState["prefillFormula"] }) => void;
  closeColumnEditor: () => void;

  /**
   * Fiche d'entité en side-peek — quand non-null, `EntityPeekPanel` s'affiche
   * à droite (overlay plein écran sur mobile). Déclenchable depuis n'importe
   * quelle surface (grille, carte, palette) via `openEntityPeek` OU via un
   * CustomEvent `supernote:open-peek` pour les surfaces hors du provider.
   */
  entityPeek: EntityPeekState | null;
  openEntityPeek: (baseId: string, entityId: string) => void;
  closeEntityPeek: () => void;

  /** Commentaires IA de la note ouverte, `null` hors note (ou colonne visible). */
  aiMargins: AiMarginsChrome | null;
  setAiMargins: (next: AiMarginsChrome | null) => void;
}

export interface EntityPeekState {
  baseId: string;
  entityId: string;
}

const ShellChromeContext = createContext<ShellChromeContextValue | null>(null);

export function ShellChromeProvider({ children }: { children: React.ReactNode }) {
  const [focusMode, setFocusModeState] = useState(false);
  // Default to true on the server / first paint to avoid a flash of "panel
  // hidden" before we can read localStorage. The effect below reconciles
  // with the persisted user preference on mount.
  const [rightPanelVisible, setRightPanelVisibleState] = useState(true);
  const [accentOverride, setAccentOverrideState] = useState<Record<string, string> | null>(null);
  const [newNoteHandlers] = useState(() => new Set<() => void>());

  const [columnEditor, setColumnEditor] = useState<ColumnEditorState | null>(null);

  const openColumnEditor = useCallback(
    (base: EntityType, view: View, opts?: { focusFieldId?: string; prefillFormula?: ColumnEditorState["prefillFormula"] }) => {
      setColumnEditor({ base, view, focusFieldId: opts?.focusFieldId, prefillFormula: opts?.prefillFormula });
    },
    [],
  );

  const closeColumnEditor = useCallback(() => {
    setColumnEditor(null);
  }, []);

  const [entityPeek, setEntityPeek] = useState<EntityPeekState | null>(null);
  const [aiMargins, setAiMarginsState] = useState<AiMarginsChrome | null>(null);

  // Même précaution que `setMobileFab` : la note republie à chaque frappe, et
  // sans ce court-circuit le shell entier (RightPanel `memo` compris) se
  // rendrait à chaque touche.
  const setAiMargins = useCallback((next: AiMarginsChrome | null) => {
    setAiMarginsState((prev) => {
      if (prev === next) return prev;
      if (!prev || !next) return next;
      if (
        prev.comments === next.comments &&
        prev.status === next.status &&
        prev.nothingToAnalyze === next.nothingToAnalyze &&
        prev.onApply === next.onApply &&
        prev.onDismiss === next.onDismiss
      ) {
        return prev;
      }
      return next;
    });
  }, []);

  const openEntityPeek = useCallback((baseId: string, entityId: string) => {
    setEntityPeek({ baseId, entityId });
  }, []);

  const closeEntityPeek = useCallback(() => {
    setEntityPeek(null);
  }, []);

  // Mobile chrome state — ignored by the desktop shell but consumed by
  // `MobileShell` to populate the top bar and FAB.
  const [mobileTitle, setMobileTitleState] = useState<string | null>(null);
  const [mobileSubtitle, setMobileSubtitleState] = useState<string | null>(null);
  const [mobileFab, setMobileFabState] = useState<MobileFabConfig | null>(null);
  const [mobileHeaderActions, setMobileHeaderActionsState] = useState<MobileHeaderAction[]>([]);

  // Le provider vit désormais à la racine (RootLayout) et survit donc aux
  // changements de route — avant, il était remonté par chaque page et cet
  // état repartait de zéro. Les panneaux liés à une surface précise (éditeur
  // de colonnes, side-peek d'entité) doivent se refermer en changeant de
  // page, sinon ils restent ouverts au-dessus d'un contenu qui n'est plus le
  // leur. Le chrome mobile, lui, est nettoyé par les cleanups des hooks.
  const pathname = usePathname();
  useEffect(() => {
    setColumnEditor(null);
    setEntityPeek(null);
  }, [pathname]);

  // Hydrate from localStorage once on mount so a refresh does not reopen
  // a panel the user previously closed.
  useEffect(() => {
    const stored = readRightPanelPreference();
    setRightPanelVisibleState(stored);
  }, []);

  // Global keyboard shortcut: Ctrl/Cmd + . toggles focus mode. We pick "."
  // because it's free in every page (Cmd+K is search, Cmd+S save, Cmd+Z
  // undo, …) and visually maps to "more / fewer chrome" affordances. The
  // listener runs at the document level so it works regardless of which
  // editor / input has focus.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.key !== "." && e.code !== "Period") return;
      e.preventDefault();
      setFocusModeState((v) => !v);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // La palette de commandes vit hors de ce provider ; elle demande le toggle du
  // panneau droit via un event window plutôt que par le contexte.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onToggle = () => {
      setRightPanelVisibleState((v) => {
        const next = !v;
        writeRightPanelPreference(next);
        return next;
      });
    };
    window.addEventListener("supernote:toggle-right-panel", onToggle);
    return () => window.removeEventListener("supernote:toggle-right-panel", onToggle);
  }, []);

  // Ouverture du side-peek depuis des surfaces hors du provider (bloc inline
  // `databaseView`, carte, etc.) sans prop-drilling : un CustomEvent window
  // `supernote:open-peek` avec `detail {baseId, entityId}` déclenche le peek.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onPeek = (e: Event) => {
      const detail = (e as CustomEvent<{ baseId?: string; entityId?: string }>).detail;
      if (detail?.baseId && detail?.entityId) {
        setEntityPeek({ baseId: detail.baseId, entityId: detail.entityId });
      }
    };
    window.addEventListener("supernote:open-peek", onPeek);
    return () => window.removeEventListener("supernote:open-peek", onPeek);
  }, []);

  const setFocusMode = useCallback((next: boolean) => {
    setFocusModeState(next);
  }, []);

  const toggleFocusMode = useCallback(() => {
    setFocusModeState((v) => !v);
  }, []);

  const setRightPanelVisible = useCallback((next: boolean) => {
    setRightPanelVisibleState(next);
    writeRightPanelPreference(next);
  }, []);

  const toggleRightPanel = useCallback(() => {
    setRightPanelVisibleState((v) => {
      const next = !v;
      writeRightPanelPreference(next);
      return next;
    });
  }, []);

  // Stable identity per (vars-shape) so AppShell's `style={...}` doesn't
  // get a fresh object on every parent render — keeps the merge cheap.
  const setAccentOverride = useCallback(
    (next: Record<string, string> | null) => {
      setAccentOverrideState((prev) => {
        if (prev === next) return prev;
        if (!prev || !next) return next;
        const a = Object.entries(prev).sort();
        const b = Object.entries(next).sort();
        if (a.length !== b.length) return next;
        for (let i = 0; i < a.length; i++) {
          if (a[i]![0] !== b[i]![0] || a[i]![1] !== b[i]![1]) return next;
        }
        return prev;
      });
    },
    [],
  );

  const requestNewNote = useCallback(() => {
    newNoteHandlers.forEach((h) => h());
  }, [newNoteHandlers]);

  const onRequestNewNote = useCallback(
    (handler: () => void) => {
      newNoteHandlers.add(handler);
      return () => {
        newNoteHandlers.delete(handler);
      };
    },
    [newNoteHandlers],
  );

  const setMobileTitle = useCallback((title: string | null) => {
    setMobileTitleState(title);
  }, []);
  const setMobileSubtitle = useCallback((subtitle: string | null) => {
    setMobileSubtitleState(subtitle);
  }, []);
  // Setters are written to bail out when the new value is structurally
  // identical to the previous one. Pages tend to rebuild the config object
  // (or actions array) on every render — without bail-out, every page render
  // would trigger a context-value churn → all consumers re-render → page
  // re-renders → infinite "Maximum update depth" loop. Comparing primitives
  // is cheap enough to do unconditionally.
  const setMobileFab = useCallback((config: MobileFabConfig | null) => {
    setMobileFabState((prev) => {
      if (prev === config) return prev;
      if (!prev || !config) return config;
      if (
        prev.icon === config.icon &&
        prev.label === config.label &&
        prev.onPress === config.onPress
      ) {
        return prev;
      }
      return config;
    });
  }, []);
  const setMobileHeaderActions = useCallback((actions: MobileHeaderAction[]) => {
    setMobileHeaderActionsState((prev) => {
      if (prev === actions) return prev;
      if (prev.length !== actions.length) return actions;
      for (let i = 0; i < actions.length; i++) {
        const a = prev[i]!;
        const b = actions[i]!;
        if (
          a.id !== b.id ||
          a.icon !== b.icon ||
          a.label !== b.label ||
          a.onPress !== b.onPress ||
          a.active !== b.active
        ) {
          return actions;
        }
      }
      return prev;
    });
  }, []);

  const value = useMemo<ShellChromeContextValue>(
    () => ({
      focusMode,
      setFocusMode,
      toggleFocusMode,
      rightPanelVisible,
      toggleRightPanel,
      setRightPanelVisible,
      accentOverride,
      setAccentOverride,
      requestNewNote,
      onRequestNewNote,
      mobileTitle,
      setMobileTitle,
      mobileSubtitle,
      setMobileSubtitle,
      mobileFab,
      setMobileFab,
      mobileHeaderActions,
      setMobileHeaderActions,
      columnEditor,
      openColumnEditor,
      closeColumnEditor,
      entityPeek,
      openEntityPeek,
      closeEntityPeek,
      aiMargins,
      setAiMargins,
    }),
    [
      focusMode,
      setFocusMode,
      toggleFocusMode,
      rightPanelVisible,
      toggleRightPanel,
      setRightPanelVisible,
      accentOverride,
      setAccentOverride,
      requestNewNote,
      onRequestNewNote,
      mobileTitle,
      setMobileTitle,
      mobileSubtitle,
      setMobileSubtitle,
      mobileFab,
      setMobileFab,
      mobileHeaderActions,
      setMobileHeaderActions,
      columnEditor,
      openColumnEditor,
      closeColumnEditor,
      entityPeek,
      openEntityPeek,
      closeEntityPeek,
      aiMargins,
      setAiMargins,
    ],
  );

  return (
    <ShellChromeContext.Provider value={value}>
      {children}
    </ShellChromeContext.Provider>
  );
}

/**
 * Vrai quand un `ShellChromeProvider` est déjà monté au-dessus. Sert à
 * `AppShell` pour réutiliser le provider racine au lieu d'en imbriquer un
 * second — un provider imbriqué couperait les pages de leur propre chrome
 * (voir `warnMissingProvider`).
 */
export function useHasShellChrome(): boolean {
  return useContext(ShellChromeContext) !== null;
}

/**
 * Les hooks de publication (`useMobileTitle`, `useMobileFab`,
 * `useMobileHeaderActions`) sont volontairement tolérants au contexte absent :
 * une page rendue hors shell ne doit pas planter. Mais l'échec était
 * TOTALEMENT silencieux — 18 pages sur 26 publiaient dans le vide parce
 * qu'elles appelaient les hooks depuis le composant qui rend lui-même
 * `<AppShell>`, donc au-dessus du provider. En mobile ça se traduisait par un
 * titre générique, aucune action d'en-tête et le FAB de repli. On aboie
 * désormais en dev.
 */
function warnMissingProvider(hook: string): void {
  if (import.meta.env.DEV) {
    console.warn(
      `[shell-chrome] ${hook}() appelé hors ShellChromeProvider — la config est ignorée. ` +
        `Appelle-le depuis un composant rendu SOUS <AppShell>, pas depuis celui qui le rend.`,
    );
  }
}

export function useShellChrome(): ShellChromeContextValue {
  const ctx = useContext(ShellChromeContext);
  if (!ctx) {
    throw new Error(
      "useShellChrome must be called from a component nested in ShellChromeProvider",
    );
  }
  return ctx;
}

/**
 * Publishes the mobile top-bar title (and optional subtitle) for the duration
 * of the calling page's mount. Does nothing on desktop — the value is just
 * not read by the desktop shell.
 *
 * Usage: `useMobileTitle("Notes", count > 0 ? `${count} notes` : null);`
 */
export function useMobileTitle(title: string | null, subtitle: string | null = null): void {
  const ctx = useContext(ShellChromeContext);
  useEffect(() => {
    if (!ctx) return warnMissingProvider("useMobileTitle");
    ctx.setMobileTitle(title);
    ctx.setMobileSubtitle(subtitle);
    return () => {
      ctx.setMobileTitle(null);
      ctx.setMobileSubtitle(null);
    };
    // We intentionally re-run only when the strings change. The setters are
    // stable callbacks from the provider.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, subtitle]);
}

/**
 * Publishes the mobile floating action button. Pass `null` when the page has
 * no primary "create" action.
 *
 * The effect re-runs only when the `label` (or null/non-null transition)
 * changes — pages can rebuild the config object on every render without
 * causing churn. The latest config is captured in a ref so the published
 * value is always fresh even when the effect itself doesn't re-run. As a
 * second line of defense, the provider's `setMobileFab` performs a
 * structural compare and bails out when nothing changed.
 */
export function useMobileFab(config: MobileFabConfig | null): void {
  const ctx = useContext(ShellChromeContext);
  const ref = useRef(config);
  ref.current = config;
  const key = config ? config.label : "__null__";
  useEffect(() => {
    if (!ctx) return warnMissingProvider("useMobileFab");
    ctx.setMobileFab(ref.current);
    return () => ctx.setMobileFab(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}

/**
 * Publishes the right-side header actions for the mobile top bar. Pass an
 * empty array when the page has no contextual actions.
 *
 * The effect re-runs when the SHAPE of the action list changes (id × label ×
 * active flag, joined into a key). Identity churn of the array or its
 * callbacks is absorbed by the latest-actions ref + the provider's
 * structural-compare setter.
 */
export function useMobileHeaderActions(actions: MobileHeaderAction[]): void {
  const ctx = useContext(ShellChromeContext);
  const ref = useRef(actions);
  ref.current = actions;
  const key = actions.map((a) => `${a.id}:${a.label}:${a.active ? "1" : "0"}`).join("|");
  useEffect(() => {
    if (!ctx) return warnMissingProvider("useMobileHeaderActions");
    ctx.setMobileHeaderActions(ref.current);
    return () => ctx.setMobileHeaderActions([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}


/**
 * Publie les commentaires IA de la note ouverte vers le panneau droit.
 * Passer `null` quand la colonne intégrée les affiche déjà, ou hors note.
 *
 * L'effet ne se relance que sur les trois valeurs réellement affichées : la
 * note republie à chaque frappe, mais `comments` ne change d'identité qu'à
 * l'arrivée d'une carte.
 */
export function useAiMarginsChrome(config: AiMarginsChrome | null): void {
  const ctx = useContext(ShellChromeContext);
  const ref = useRef(config);
  ref.current = config;
  const comments = config?.comments;
  const status = config?.status;
  const nothing = config?.nothingToAnalyze;
  useEffect(() => {
    if (!ctx) return warnMissingProvider("useAiMarginsChrome");
    ctx.setAiMargins(ref.current);
    return () => ctx.setAiMargins(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [comments, status, nothing]);
}
