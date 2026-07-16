import * as React from "react";
import { flushSync } from "react-dom";
import { ThemeProvider as NextThemesProvider, useTheme } from "next-themes";

export interface ThemeProviderProps {
  children: React.ReactNode;
  /** Default theme when none is stored. */
  defaultTheme?: "light" | "dark" | "system";
  /** Storage key. */
  storageKey?: string;
}

/**
 * ThemeProvider — wraps next-themes with the `data-theme` attribute strategy
 * so CSS custom properties respond to `[data-theme="dark"]` selectors.
 */
export function ThemeProvider({
  children,
  defaultTheme = "light",
  storageKey = "supernote-theme",
}: ThemeProviderProps) {
  return (
    <NextThemesProvider
      attribute="data-theme"
      defaultTheme={defaultTheme}
      storageKey={storageKey}
      themes={["light", "dark", "system"]}
    >
      {children}
    </NextThemesProvider>
  );
}

export type ThemeValue = "light" | "dark" | "system";

export interface UseThemeReturn {
  theme: ThemeValue | undefined;
  setTheme: (theme: ThemeValue) => void;
  resolvedTheme: "light" | "dark" | undefined;
  systemTheme: "light" | "dark" | undefined;
}

/**
 * useAppTheme — typed wrapper around next-themes `useTheme`.
 */
export function useAppTheme(): UseThemeReturn {
  const { theme, setTheme, resolvedTheme, systemTheme } = useTheme();
  return {
    theme: theme as ThemeValue | undefined,
    setTheme: setTheme as (t: ThemeValue) => void,
    resolvedTheme: resolvedTheme as "light" | "dark" | undefined,
    systemTheme: systemTheme as "light" | "dark" | undefined,
  };
}

// ── Bascule de thème en révélation circulaire ────────────────────────────────

/** Origine (px viewport) de la révélation circulaire — typiquement le centre
 *  du contrôle cliqué. Sans origine, cross-fade natif du navigateur. */
export interface ThemeTransitionOrigin {
  x: number;
  y: number;
}

interface ViewTransitionLike {
  ready: Promise<void>;
  finished: Promise<void>;
}

type DocumentWithViewTransition = Document & {
  startViewTransition?: (updateCallback: () => void) => ViewTransitionLike;
};

/** Centre d'un élément DOM en coordonnées viewport — helper pour brancher un
 *  bouton de bascule : `setThemeWithTransition(setTheme, t, originFromElement(e.currentTarget))`. */
export function originFromElement(el: Element): ThemeTransitionOrigin {
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

/** Lit un token motion `--sn-*` au runtime (fallback si l'app hôte ne le
 *  définit pas — le package ne peut pas présumer de globals.css). */
function readMotionToken(name: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

/* Garde de réentrance : des taps rapides sur le cycle de thème empileraient
 * des snapshots plein écran (coûteux, risque de jank main-thread — cf. la
 * même politique routeur sur mobile). Transition en cours → bascule directe. */
let themeTransitionRunning = false;

/**
 * setThemeWithTransition — bascule le thème via la View Transitions API en
 * révélation circulaire depuis `origin` (WAAPI `clip-path: circle(0 → R)` sur
 * `::view-transition-new(root)`).
 *
 * Dégradés :
 *  - pas de `document.startViewTransition` OU `prefers-reduced-motion` →
 *    `setTheme` direct, aucun snapshot ;
 *  - pas d'`origin` → cross-fade natif (on ne pose pas `data-theme-transition`,
 *    les animations par défaut restent actives).
 *
 * `flushSync` dans le callback : `setTheme` est un setState React — le DOM
 * (attribut `data-theme`) doit être muté avant que l'API capture le snapshot
 * « new ».
 */
export function setThemeWithTransition(
  setTheme: (theme: ThemeValue) => void,
  theme: ThemeValue,
  origin?: ThemeTransitionOrigin,
): void {
  if (typeof document === "undefined") {
    setTheme(theme);
    return;
  }
  const doc = document as DocumentWithViewTransition;
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!doc.startViewTransition || reducedMotion || themeTransitionRunning) {
    setTheme(theme);
    return;
  }

  themeTransitionRunning = true;
  const root = document.documentElement;
  // data-theme-transition neutralise le cross-fade par défaut (globals.css)
  // pour laisser le clip-path dessiner seul — uniquement en mode révélation.
  if (origin) root.dataset.themeTransition = "1";

  const vt = doc.startViewTransition(() => {
    flushSync(() => {
      setTheme(theme);
    });
  });

  if (origin) {
    const { x, y } = origin;
    // Rayon = hypoténuse jusqu'au coin du viewport le plus éloigné de l'origine.
    const radius = Math.hypot(
      Math.max(x, window.innerWidth - x),
      Math.max(y, window.innerHeight - y),
    );
    const duration = Number.parseFloat(readMotionToken("--sn-dur-5", "380ms"));
    const easing = readMotionToken("--sn-ease-glide", "cubic-bezier(0.16, 1, 0.3, 1)");
    vt.ready
      .then(() => {
        root.animate(
          {
            clipPath: [
              `circle(0px at ${x}px ${y}px)`,
              `circle(${radius}px at ${x}px ${y}px)`,
            ],
          },
          {
            duration: Number.isFinite(duration) ? duration : 380,
            easing,
            pseudoElement: "::view-transition-new(root)",
          },
        );
      })
      .catch(() => {
        /* Transition sautée par le navigateur — le thème est déjà appliqué. */
      });
  }

  void vt.finished.finally(() => {
    themeTransitionRunning = false;
    delete root.dataset.themeTransition;
  });
}
