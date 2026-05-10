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
import type { Icon as PhosphorIcon } from "@phosphor-icons/react";

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
  /** Click handler. */
  onPress: () => void;
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

  // Mobile chrome state — ignored by the desktop shell but consumed by
  // `MobileShell` to populate the top bar and FAB.
  const [mobileTitle, setMobileTitleState] = useState<string | null>(null);
  const [mobileSubtitle, setMobileSubtitleState] = useState<string | null>(null);
  const [mobileFab, setMobileFabState] = useState<MobileFabConfig | null>(null);
  const [mobileHeaderActions, setMobileHeaderActionsState] = useState<MobileHeaderAction[]>([]);

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
    ],
  );

  return (
    <ShellChromeContext.Provider value={value}>
      {children}
    </ShellChromeContext.Provider>
  );
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
    if (!ctx) return;
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
    if (!ctx) return;
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
    if (!ctx) return;
    ctx.setMobileHeaderActions(ref.current);
    return () => ctx.setMobileHeaderActions([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}

