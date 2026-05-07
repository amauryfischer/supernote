import * as React from "react";
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
