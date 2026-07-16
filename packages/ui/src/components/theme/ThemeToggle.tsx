import * as React from "react";
import {
  useAppTheme,
  setThemeWithTransition,
  originFromElement,
  type ThemeValue,
} from "./ThemeProvider.js";
import { cn } from "../../cn.js";

export interface ThemeToggleProps {
  /** Show system option in addition to light/dark. */
  showSystem?: boolean;
  /** Additional class. */
  className?: string;
}

const OPTIONS: Array<{ key: ThemeValue; label: string }> = [
  { key: "light",  label: "Light" },
  { key: "dark",   label: "Dark" },
  { key: "system", label: "System" },
];

/**
 * ThemeToggle — three-way button group: Light / Dark / System.
 * Requires ThemeProvider ancestor.
 */
export function ThemeToggle({ showSystem = true, className }: ThemeToggleProps) {
  const { theme, setTheme } = useAppTheme();
  const options = showSystem ? OPTIONS : OPTIONS.slice(0, 2);

  return (
    <div
      className={cn(
        "inline-flex items-center rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-2)] p-0.5",
        className
      )}
      role="group"
      aria-label="Theme selection"
    >
      {options.map((opt) => (
        <button
          key={opt.key}
          onClick={(e) =>
            // Révélation circulaire depuis le centre du bouton cliqué.
            setThemeWithTransition(setTheme, opt.key, originFromElement(e.currentTarget))
          }
          aria-pressed={theme === opt.key}
          className={cn(
            "rounded-[calc(var(--radius-md)-2px)] px-3 py-1.5 text-xs font-medium transition-colors",
            theme === opt.key
              ? "bg-[var(--surface-1)] text-[var(--text-primary)] [box-shadow:var(--shadow-sm)]"
              : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
